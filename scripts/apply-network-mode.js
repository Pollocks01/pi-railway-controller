'use strict';

// Run once at boot, before the main server starts accepting connections
// on the WiFi interface (see the systemd unit in the README's networking
// section). Reads the physical 2-way switch, then creates/updates and
// activates the matching NetworkManager connection profile.
//
// Deliberately NOT hot-swapped while the app is running -- per the
// project decision, flipping the switch takes effect on the next reboot.
// That keeps this script simple (run once, exit) and avoids the app
// having to cope with its own network interface changing out from under
// it mid-session.
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
const { readNetworkMode } = require('../gpio/networkModeSwitch');
const { usingMock } = require('../gpio');

const STATUS_PATH = process.env.RAILWAY_NETWORK_STATUS_PATH || path.join(__dirname, '..', 'data', 'network-mode-status.json');
const AP_CONNECTION_NAME = 'railway-ap';
const STA_CONNECTION_NAME = 'railway-sta';
const WIFI_INTERFACE = process.env.RAILWAY_WIFI_IFACE || 'wlan0';

const DRY_RUN = process.env.RAILWAY_SKIP_NETWORK_APPLY === '1' || usingMock;

function log(...args) {
  console.log('[apply-network-mode]', ...args);
}

function connectionExists(name) {
  if (DRY_RUN) return false;
  try {
    execFileSync('nmcli', ['-t', '-f', 'NAME', 'connection', 'show', name], { stdio: 'pipe' });
    return true;
  } catch {
    return false;
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

  if (!connectionExists(AP_CONNECTION_NAME)) {
    run(['connection', 'add', 'type', 'wifi', 'ifname', WIFI_INTERFACE, 'con-name', AP_CONNECTION_NAME, 'autoconnect', 'no', 'ssid', ssid]);
  }

  const modifyArgs = [
    'connection', 'modify', AP_CONNECTION_NAME,
    '802-11-wireless.ssid', ssid,
    '802-11-wireless.mode', 'ap',
    '802-11-wireless.band', 'bg',
    'ipv4.method', 'shared',
    // NetworkManager's "shared" method defaults to 10.42.0.1, not the
    // 192.168.4.1 this project's docs and the shuttle firmware's PI_HOST
    // constant assume (that address comes from the older hostapd/dnsmasq
    // convention). Pin it explicitly so everything stays consistent.
    'ipv4.addresses', '192.168.4.1/24',
  ];
  if (password) {
    modifyArgs.push('wifi-sec.key-mgmt', 'wpa-psk', 'wifi-sec.psk', password);
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

  if (!connectionExists(STA_CONNECTION_NAME)) {
    run(['connection', 'add', 'type', 'wifi', 'ifname', WIFI_INTERFACE, 'con-name', STA_CONNECTION_NAME, 'ssid', ssid]);
  }

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
  const mode = readNetworkMode();
  log(`Switch read as: ${mode}${DRY_RUN ? ' (DRY RUN -- no changes will be applied)' : ''}`);

  const status = {
    mode,
    appliedAt: new Date().toISOString(),
    dryRun: DRY_RUN,
    ssid: mode === 'ap' ? settings.networkApSsid : settings.networkStaSsid,
    ok: true,
    error: null,
  };

  try {
    if (mode === 'ap') applyApMode(settings.networkApSsid, settings.networkApPassword);
    else applyStaMode(settings.networkStaSsid, settings.networkStaPassword);
  } catch (err) {
    status.ok = false;
    status.error = err.message;
    log('ERROR applying network mode:', err.message);
  }

  writeStatus(status);
  log('Done.', DRY_RUN ? '(dry run, nothing was actually changed)' : '');
}

main();
