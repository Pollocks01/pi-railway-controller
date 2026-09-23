'use strict';

// Run once at boot, before the main server starts accepting connections
// on the WiFi interface (see the systemd unit in the README's networking
// section). Creates/updates and activates the AP NetworkManager connection
// profile.
//
// This Pi is permanently fixed to AP mode (2026-09-23) -- there used to be
// a physical 2-way switch (read via gpio/networkModeSwitch.js) to choose
// AP vs. joining a home network for maintenance, but that switch's 2 GPIOs
// were needed back for a 3rd signal (see gpio/pinMap.js), and AP-only is
// fine going forward. STA mode support (applyStaMode() below) is left in
// place in case a future pin budget frees up 2 spare GPIOs again, but
// nothing calls it anymore.
//
// SAFETY: this script shells out to `nmcli` and requires root (or a user
// with NetworkManager permissions via polkit) to actually change system
// networking. In this dev/test environment (no real Pi, no nmcli), set
// RAILWAY_SKIP_NETWORK_APPLY=1 to log what *would* happen without
// shelling out -- this is also useful on the Pi itself for a dry run.

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const { Settings } = require('../config/configStore');
const { usingMock } = require('../gpio');

const STATUS_PATH = process.env.RAILWAY_NETWORK_STATUS_PATH || path.join(__dirname, '..', 'data', 'network-mode-status.json');
const AP_CONNECTION_NAME = 'railway-ap';
const STA_CONNECTION_NAME = 'railway-sta';
const WIFI_INTERFACE = process.env.RAILWAY_WIFI_IFACE || 'wlan0';
// Separate override for AP mode specifically -- lets AP duties run on a
// dedicated USB WiFi dongle (e.g. 'wlan1') instead of the Pi's onboard
// chip, which has a well-documented, apparently unfixable regulatory
// domain quirk (phy0 stuck at "country 99: DFS-UNSET" regardless of the
// system-wide country setting). STA mode still defaults to the onboard
// chip via WIFI_INTERFACE unless RAILWAY_WIFI_STA_IFACE is also set.
const WIFI_AP_INTERFACE = process.env.RAILWAY_WIFI_AP_IFACE || WIFI_INTERFACE;
const WIFI_STA_INTERFACE = process.env.RAILWAY_WIFI_STA_IFACE || WIFI_INTERFACE;

const DRY_RUN = process.env.RAILWAY_SKIP_NETWORK_APPLY === '1' || usingMock;

function log(...args) {
  console.log('[apply-network-mode]', ...args);
}

// NetworkManager only guarantees UUIDs are unique -- multiple connections
// can share the same NAME. If connectionExists() ever raced (e.g. D-Bus
// busy at boot) and let a duplicate 'connection add' slip through, then
// every subsequent 'connection modify <name>' / 'connection up <name>'
// call becomes ambiguous: NM picks one of the duplicates somewhat
// arbitrarily, which can silently pick an older one missing a fix like
// the PMF workaround below. Delete every connection with this name and
// rebuild fresh each run -- this is called before add/modify in both
// applyApMode() and applyStaMode() so it's impossible to end up with
// more than one, regardless of why a duplicate got created.
function deleteAllNamed(name) {
  if (DRY_RUN) {
    log(`[dry-run] would delete all connections named ${name}`);
    return;
  }
  let uuids = [];
  try {
    uuids = execFileSync('nmcli', ['-t', '-f', 'NAME,UUID', 'connection', 'show'], { stdio: 'pipe' })
      .toString()
      .split('\n')
      .filter((line) => line.startsWith(`${name}:`))
      .map((line) => line.split(':')[1])
      .filter(Boolean);
  } catch (err) {
    log(`WARNING: could not list connections to clean up ${name}: ${err.message}`);
    return;
  }
  for (const uuid of uuids) {
    runBestEffort(['connection', 'delete', uuid]);
  }
}

function run(args) {
  if (DRY_RUN) {
    log('[dry-run] nmcli', args.join(' '));
    return;
  }
  execFileSync('nmcli', args, { stdio: 'inherit' });
}

function runBestEffort(args) {
  try {
    run(args);
  } catch (err) {
    log(`WARNING: command failed (continuing): nmcli ${args.join(' ')} -- ${err.message}`);
  }
}

function applyApMode(ssid, password) {
  log(`Applying AP mode, ssid="${ssid}"`);
  if (!ssid) {
    log('ERROR: no AP SSID configured (Settings.networkApSsid) -- cannot start AP. Set it via the UI and reboot.');
    return;
  }

  deleteAllNamed(AP_CONNECTION_NAME);
  run(['connection', 'add', 'type', 'wifi', 'ifname', WIFI_AP_INTERFACE, 'con-name', AP_CONNECTION_NAME, 'autoconnect', 'no', 'ssid', ssid]);

  const modifyArgs = [
    'connection', 'modify', AP_CONNECTION_NAME,
    '802-11-wireless.ssid', ssid,
    '802-11-wireless.mode', 'ap',
    '802-11-wireless.band', 'bg',
    // Leaving the channel on auto lets NetworkManager pick 12/13, which
    // are legal in the UK/EU but region-locked-out on many phones
    // (notably US-region iPhones won't see or join a 12/13 network at
    // all). Pin to channel 6 -- legal and universally supported.
    '802-11-wireless.channel', '6',
    'ipv4.method', 'shared',
    // NetworkManager's "shared" method defaults to 10.42.0.1, not the
    // 192.168.4.1 this project's docs and the shuttle firmware's PI_HOST
    // constant assume (that address comes from the older hostapd/dnsmasq
    // convention). Pin it explicitly so everything stays consistent.
    'ipv4.addresses', '192.168.4.1/24',
  ];
  if (password) {
    modifyArgs.push('wifi-sec.key-mgmt', 'wpa-psk', 'wifi-sec.psk', password);
    // Without an explicit protocol, NetworkManager can advertise a
    // WPA/WPA2 mixed-mode AP (both WPA1-TKIP and WPA2-RSN IEs present).
    // The ESP32 shuttle's WiFi driver rejects that combination during
    // its internal auth-mode scan filter with disconnect reason 211
    // (NO_AP_FOUND_IN_AUTHMODE_THRESHOLD) -- it never even attempts
    // authentication. Pin to pure WPA2 (RSN/CCMP only) to avoid the
    // ambiguity outright.
    modifyArgs.push('802-11-wireless-security.proto', 'rsn');
    modifyArgs.push('802-11-wireless-security.pairwise', 'ccmp');
    modifyArgs.push('802-11-wireless-security.group', 'ccmp');
    // Raspberry Pi 3B + NetworkManager has a known bug bringing up a
    // WPA-PSK AP-mode connection: it fails with "802.1X supplicant took
    // too long to authenticate" (PMF negotiation issue between
    // wpa_supplicant and the onboard chip's AP mode). Doesn't affect
    // STA/client connections, only AP. Disabling PMF on this profile
    // works around it. See:
    // https://github.com/raspberrypi/trixie-feedback/issues/29
    modifyArgs.push('802-11-wireless-security.pmf', '1');
  } else {
    log('WARNING: no AP password set -- starting an OPEN access point. Set networkApPassword via the UI for a protected show network.');
    modifyArgs.push('wifi-sec.key-mgmt', 'none');
  }
  run(modifyArgs);

  runBestEffort(['connection', 'down', STA_CONNECTION_NAME]);
  run(['connection', 'up', AP_CONNECTION_NAME]);
}

function applyStaMode(ssid, password) {
  log(`Applying home-network (STA) mode, ssid="${ssid}"`);
  if (!ssid) {
    log('ERROR: no home network SSID configured (Settings.networkStaSsid) -- cannot join a network. Set it via the UI and reboot.');
    return;
  }

  deleteAllNamed(STA_CONNECTION_NAME);
  run(['connection', 'add', 'type', 'wifi', 'ifname', WIFI_STA_INTERFACE, 'con-name', STA_CONNECTION_NAME, 'ssid', ssid]);

  const modifyArgs = [
    'connection', 'modify', STA_CONNECTION_NAME,
    '802-11-wireless.ssid', ssid,
    'ipv4.method', 'auto',
  ];
  if (password) {
    modifyArgs.push('wifi-sec.key-mgmt', 'wpa-psk', 'wifi-sec.psk', password);
  } else {
    modifyArgs.push('wifi-sec.key-mgmt', 'none');
  }
  run(modifyArgs);

  runBestEffort(['connection', 'down', AP_CONNECTION_NAME]);
  run(['connection', 'up', STA_CONNECTION_NAME]);
}

function writeStatus(status) {
  try {
    const dir = path.dirname(STATUS_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(STATUS_PATH, JSON.stringify(status, null, 2));
  } catch (err) {
    log(`WARNING: could not write status file: ${err.message}`);
  }
}

function main() {
  const settings = Settings.getAll();
  const mode = 'ap'; // fixed -- see the file header note
  log(`Mode: ${mode} (fixed)${DRY_RUN ? ' (DRY RUN -- no changes will be applied)' : ''}`);

  const status = {
    mode,
    appliedAt: new Date().toISOString(),
    dryRun: DRY_RUN,
    ssid: settings.networkApSsid,
    ok: true,
    error: null,
  };

  try {
    applyApMode(settings.networkApSsid, settings.networkApPassword);
  } catch (err) {
    status.ok = false;
    status.error = err.message;
    log('ERROR applying network mode:', err.message);
  }

  writeStatus(status);
  log('Done.', DRY_RUN ? '(dry run, nothing was actually changed)' : '');
}

main();