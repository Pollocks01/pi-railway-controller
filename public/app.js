'use strict';

// ---------------------------------------------------------------------
// Generic modal (config authoring: every "+ Add X" action reuses this
// instead of bespoke markup per type)
// ---------------------------------------------------------------------

function openModal({ title, fields, submitLabel = 'Add', onSubmit }) {
  const overlay = document.getElementById('modalOverlay');
  const form = document.getElementById('modalForm');
  const errorEl = document.getElementById('modalError');
  const submitBtn = document.getElementById('modalSubmitBtn');
  const cancelBtn = document.getElementById('modalCancelBtn');

  document.getElementById('modalTitle').textContent = title;
  submitBtn.textContent = submitLabel;
  errorEl.hidden = true;
  errorEl.textContent = '';
  form.innerHTML = '';

  for (const field of fields) {
    const label = document.createElement('label');
    label.className = 'field-label';
    label.textContent = field.label;

    let input;
    if (field.type === 'select') {
      input = document.createElement('select');
      for (const opt of field.options) {
        const optionEl = document.createElement('option');
        optionEl.value = opt.value;
        optionEl.textContent = opt.label;
        input.appendChild(optionEl);
      }
    } else {
      input = document.createElement('input');
      input.type = field.type || 'text';
      if (field.defaultValue !== undefined) input.value = field.defaultValue;
      if (field.min !== undefined) input.min = field.min;
      if (field.max !== undefined) input.max = field.max;
    }
    input.name = field.name;
    if (field.required) input.required = true;
    label.appendChild(input);
    form.appendChild(label);
  }

  function close() {
    overlay.hidden = true;
    form.onsubmit = null;
    cancelBtn.onclick = null;
  }

  cancelBtn.onclick = close;

  form.onsubmit = async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(form).entries());
    submitBtn.disabled = true;
    errorEl.hidden = true;
    try {
      await onSubmit(data);
      close();
      window.location.reload();
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.hidden = false;
    } finally {
      submitBtn.disabled = false;
    }
  };

  overlay.hidden = false;
  form.querySelector('input, select')?.focus();
}

async function confirmAndDelete(message, url) {
  if (!confirm(message)) return;
  try {
    await deleteJson(url);
    window.location.reload();
  } catch (err) {
    alert(err.message);
  }
}

const getInventory = () => getJson('/api/inventory');

function numberOptions(numbers, labelPrefix) {
  if (numbers.length === 0) return [{ value: '', label: '(none free -- delete something first)' }];
  return numbers.map((n) => ({ value: String(n), label: `${labelPrefix} ${n}` }));
}

function triggerAddTrack12v() {
  openModal({
    title: 'Add 12V Layout',
    submitLabel: 'Add Layout',
    fields: [
      { name: 'name', label: 'Name', type: 'text', required: true, defaultValue: 'New 12V Layout' },
      {
        name: 'topology',
        label: 'Topology',
        type: 'select',
        options: [
          { value: 'loop', label: 'Loop' },
          { value: 'length', label: 'Length (point-to-point)' },
        ],
      },
    ],
    onSubmit: (data) => postJson('/api/tracks-12v', data),
  });
}

function triggerAddTrack45v() {
  openModal({
    title: 'Add 4.5V Shuttle Line',
    submitLabel: 'Add Line',
    fields: [{ name: 'name', label: 'Name', type: 'text', required: true, defaultValue: 'New Shuttle Line' }],
    onSubmit: (data) => postJson('/api/tracks-45v', data),
  });
}

async function triggerAddZone(track) {
  const inventory = await getInventory();
  openModal({
    title: `Add Zone to ${track.name}`,
    submitLabel: 'Add Zone',
    fields: [
      { name: 'name', label: 'Name', type: 'text', required: true, defaultValue: `Zone ${track.zones.length + 1}` },
      { name: 'sequenceIndex', label: 'Sequence position', type: 'number', min: 0, defaultValue: track.zones.length },
      { name: 'driverNumber', label: 'Zone driver #', type: 'select', options: numberOptions(inventory.availableZoneDrivers, 'Driver') },
    ],
    onSubmit: (data) =>
      postJson(`/api/tracks-12v/${track.id}/zones`, {
        name: data.name,
        sequenceIndex: Number(data.sequenceIndex),
        driverNumber: Number(data.driverNumber),
      }),
  });
}

async function triggerAddSensor12v(track, zone) {
  const inventory = await getInventory();
  const roleOptions = [
    { value: 'station', label: 'Station stop' },
    { value: 'block-entry', label: 'Block entry' },
  ];
  // 'end-of-line' sensors are added via the track's ends-row instead (see
  // triggerAddEndSensor12v) -- same place the 4.5V shuttle line's location
  // sensors are added, since both need an east/west designation.
  openModal({
    title: `Add Sensor to ${zone.name}`,
    submitLabel: 'Add Sensor',
    fields: [
      { name: 'name', label: 'Name', type: 'text', required: true, defaultValue: 'New sensor' },
      { name: 'role', label: 'Role', type: 'select', options: roleOptions },
      {
        name: 'edge',
        label: 'Trigger edge (which end of the train fires it)',
        type: 'select',
        options: [
          { value: 'leading', label: 'Leading edge (default -- front of train arrives)' },
          { value: 'trailing', label: 'Trailing edge (back of train clears)' },
        ],
      },
      { name: 'sensorNumber', label: 'Sensor #', type: 'select', options: numberOptions(inventory.availableSensorNumbers, 'Sensor') },
    ],
    onSubmit: (data) =>
      postJson(`/api/tracks-12v/${track.id}/zones/${zone.id}/sensors`, {
        name: data.name,
        role: data.role,
        edge: data.edge,
        sensorNumber: Number(data.sensorNumber),
      }),
  });
}

async function triggerAddSignal(sensor) {
  const inventory = await getInventory();
  openModal({
    title: `Add Signal for ${sensor.name}`,
    submitLabel: 'Add Signal',
    fields: [
      { name: 'name', label: 'Name', type: 'text', required: true, defaultValue: `${sensor.name} signal` },
      { name: 'signalNumber', label: 'Signal #', type: 'select', options: numberOptions(inventory.availableSignalNumbers, 'Signal') },
    ],
    onSubmit: (data) => postJson('/api/signals', { name: data.name, signalNumber: Number(data.signalNumber), sensorId: sensor.id }),
  });
}

function triggerAddTrain(track) {
  const zoneOptions = track.zones.map((z) => ({ value: z.id, label: z.name }));
  openModal({
    title: `Add Train to ${track.name}`,
    submitLabel: 'Add Train',
    fields: [
      { name: 'name', label: 'Name', type: 'text', required: true, defaultValue: 'New train' },
      { name: 'startingZoneId', label: 'Starting zone', type: 'select', options: zoneOptions },
    ],
    onSubmit: (data) => postJson(`/api/tracks-12v/${track.id}/trains`, data),
  });
}

async function triggerAddLocationSensor(track, end) {
  const inventory = await getInventory();
  openModal({
    title: `Add ${end.toUpperCase()} Location Sensor`,
    submitLabel: 'Add Sensor',
    fields: [
      { name: 'name', label: 'Name', type: 'text', required: true, defaultValue: `${end} end sensor` },
      { name: 'sensorNumber', label: 'Sensor #', type: 'select', options: numberOptions(inventory.availableSensorNumbers, 'Sensor') },
    ],
    onSubmit: (data) =>
      postJson(`/api/tracks-45v/${track.id}/sensors`, { name: data.name, endOfLine: end, sensorNumber: Number(data.sensorNumber) }),
  });
}

async function triggerAddJunction(track, end) {
  const inventory = await getInventory();
  const slotOptions =
    inventory.availableJunctionSlots.length === 0
      ? [{ value: '', label: '(none free -- delete something first)' }]
      : inventory.availableJunctionSlots.map((s) => ({
          value: `${s.driverNumber}:${s.channel}`,
          label: `Driver ${s.driverNumber}, Channel ${s.channel}`,
        }));
  openModal({
    title: `Add Junction at ${end.toUpperCase()} end`,
    submitLabel: 'Add Junction',
    fields: [
      { name: 'name', label: 'Name', type: 'text', required: true, defaultValue: `${end} junction` },
      { name: 'slot', label: 'Driver / channel', type: 'select', options: slotOptions },
      { name: 'moveDurationMs', label: 'Move duration (ms)', type: 'number', min: 100, defaultValue: 200 },
      { name: 'routeWeight', label: 'Route weight', type: 'number', min: 0.1, defaultValue: 1 },
    ],
    onSubmit: (data) => {
      const [driverNumber, channel] = data.slot.split(':').map(Number);
      return postJson(`/api/tracks-45v/${track.id}/junctions`, {
        name: data.name,
        end,
        driverNumber,
        driverChannel: channel,
        moveDurationMs: Number(data.moveDurationMs),
        routeWeight: Number(data.routeWeight),
      });
    },
  });
}

async function triggerAddEndSensor12v(track, end) {
  const inventory = await getInventory();
  // Same simplification as the shuttle line: one end-of-line sensor per
  // physical end. Auto-picks the zone at that end of the length track
  // (west -> first zone, east -> last zone) rather than asking, since the
  // 4.5V equivalent doesn't have a zone concept to ask about at all.
  const zone = end === 'west' ? track.zones[0] : track.zones[track.zones.length - 1];
  if (!zone) {
    alert('Add at least one zone to this track before adding an end sensor.');
    return;
  }
  openModal({
    title: `Add ${end.toUpperCase()} End Sensor`,
    submitLabel: 'Add Sensor',
    fields: [
      { name: 'name', label: 'Name', type: 'text', required: true, defaultValue: `${end} end sensor` },
      { name: 'sensorNumber', label: 'Sensor #', type: 'select', options: numberOptions(inventory.availableSensorNumbers, 'Sensor') },
    ],
    onSubmit: (data) =>
      postJson(`/api/tracks-12v/${track.id}/zones/${zone.id}/sensors`, {
        name: data.name,
        role: 'end-of-line',
        endOfLine: end,
        edge: 'leading',
        sensorNumber: Number(data.sensorNumber),
      }),
  });
}

async function triggerAddJunction12v(track, end) {
  const inventory = await getInventory();
  const slotOptions =
    inventory.availableJunctionSlots.length === 0
      ? [{ value: '', label: '(none free -- delete something first)' }]
      : inventory.availableJunctionSlots.map((s) => ({
          value: `${s.driverNumber}:${s.channel}`,
          label: `Driver ${s.driverNumber}, Channel ${s.channel}`,
        }));
  openModal({
    title: `Add Junction at ${end.toUpperCase()} end`,
    submitLabel: 'Add Junction',
    fields: [
      { name: 'name', label: 'Name', type: 'text', required: true, defaultValue: `${end} junction` },
      { name: 'slot', label: 'Driver / channel', type: 'select', options: slotOptions },
      { name: 'moveDurationMs', label: 'Move duration (ms)', type: 'number', min: 100, defaultValue: 200 },
      { name: 'routeWeight', label: 'Route weight', type: 'number', min: 0.1, defaultValue: 1 },
    ],
    onSubmit: (data) => {
      const [driverNumber, channel] = data.slot.split(':').map(Number);
      return postJson(`/api/tracks-12v/${track.id}/junctions`, {
        name: data.name,
        end,
        driverNumber,
        driverChannel: channel,
        moveDurationMs: Number(data.moveDurationMs),
        routeWeight: Number(data.routeWeight),
      });
    },
  });
}

// ---------------------------------------------------------------------
// Small fetch helpers
// ---------------------------------------------------------------------

async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  return res.json();
}

async function postJson(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `${url} -> ${res.status}`);
  return json;
}

async function deleteJson(url) {
  const res = await fetch(url, { method: 'DELETE' });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `${url} -> ${res.status}`);
  return json;
}

function withBusyFeedback(el, fn) {
  const isButton = el.tagName === 'BUTTON';
  return async (...args) => {
    const original = isButton ? el.textContent : null;
    el.disabled = true;
    try {
      await fn(...args);
    } catch (err) {
      console.error(err);
      alert(err.message);
    } finally {
      el.disabled = false;
      if (isButton) el.textContent = original;
    }
  };
}

// ---------------------------------------------------------------------
// Registries so websocket updates can find the right DOM without
// rebuilding it -- keeps sliders/selects stable under the operator's hand.
// ---------------------------------------------------------------------

const zoneEls = new Map();       // zoneId -> { row, powerLed, occupiedChip, speed, stationChip, signalLed }
const trackEls = new Map();      // trackId -> { modeBadge, modeSelect, slider, speedReadout }
const shuttleTrackEls = new Map(); // shuttleTrackId -> { west: {led, occupancyChip}, east: {led, occupancyChip} }
const junctionEls = new Map();   // junctionId -> { positionChip }
const shuttleEls = new Map();    // shuttleId -> { onlineLed, telemetry, modeSelect, slider, speedReadout, nameInput }
const signalEls = new Map();     // signalId -> HTMLElement (the dot)

let latestData = { tracks12v: [], tracks45v: [], shuttles: [] };

// ---------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------

async function boot() {
  try {
    const [tracks12v, tracks45v, shuttles, signals, status] = await Promise.all([
      getJson('/api/tracks-12v'),
      getJson('/api/tracks-45v'),
      getJson('/api/shuttles'),
      getJson('/api/signals'),
      getJson('/api/status'),
    ]);
    latestData = { tracks12v, tracks45v, shuttles, signals };

    document.getElementById('gpioModeLabel').textContent = status.gpio?.usingMock
      ? 'GPIO: mock (dev)'
      : 'GPIO: hardware';
    document.getElementById('gpioModeLabel').className = status.gpio?.usingMock ? 'chip chip-warn' : 'chip chip-active';
    document.getElementById('footerStarted').textContent = `Controller started ${new Date(status.startedAt).toLocaleString()}`;

    buildTracks12v(tracks12v, signals);
    buildTracks45v(tracks45v, shuttles);
    buildUnassignedShuttles(tracks45v, shuttles);
    await initSettingsPanel();
    await initShuttle45vSettingsPanel();
    await initNetworkPanel();

    await Promise.all(tracks12v.map((t) => syncTrackControlState(t.id)));

    document.getElementById('emptyState').hidden = tracks12v.length > 0 || tracks45v.length > 0;

    document.getElementById('addTrack12vBtn').addEventListener('click', triggerAddTrack12v);
    document.getElementById('addTrack45vBtn').addEventListener('click', triggerAddTrack45v);

    applySnapshot(status.runtime);
    connectWebSocket();
  } catch (err) {
    console.error(err);
    document.getElementById('app').innerHTML = `<p style="padding:2rem;color:#ef4444">Failed to load layout: ${err.message}</p>`;
  }
}

// ---------------------------------------------------------------------
// Controller settings panel
// ---------------------------------------------------------------------

async function initSettingsPanel() {
  const fields = [
    ['settingsDwellMsMin', 'track12vDwellMsMin'],
    ['settingsDwellMsMax', 'track12vDwellMsMax'],
    ['settingsStationLockoutMs', 'track12vStationLockoutMs'],
    ['settingsSensorDebounceMs', 'track12vSensorDebounceMs'],
    ['settingsRampStepPercent', 'track12vRampStepPercent'],
    ['settingsRampStepIntervalMs', 'track12vRampStepIntervalMs'],
    ['settingsTrain12vMinMotorPercent', 'track12vMinMotorPercent'],
    ['settingsTrain12vMaxMotorPercent', 'track12vMaxMotorPercent'],
    ['settingsJunctionDefaultMoveDurationMs', 'junctionDefaultMoveDurationMs'],
    ['settingsSignalBrightnessPercent', 'signalBrightnessPercent'],
  ];

  const saveBtn = document.getElementById('settingsSaveBtn');
  const saveResultEl = document.getElementById('settingsSaveResult');

  const loadSettings = async () => {
    const settings = await getJson('/api/settings');
    for (const [id, key] of fields) {
      const el = document.getElementById(id);
      if (el) el.value = settings[key] ?? '';
    }
  };

  await loadSettings();

  saveBtn.addEventListener(
    'click',
    withBusyFeedback(saveBtn, async () => {
      saveResultEl.textContent = '';
      const payload = {};
      for (const [id, key] of fields) {
        const el = document.getElementById(id);
        payload[key] = Number(el.value);
      }
      await postJson('/api/settings', payload);
      saveResultEl.textContent = 'Saved';
    })
  );
}

// ---------------------------------------------------------------------
// 4.5V shuttle settings panel -- Pi-side profile pushed to every shuttle
// ---------------------------------------------------------------------

async function initShuttle45vSettingsPanel() {
  const fields = [
    ['settings45vDwellMsMin', 'shuttle45vDwellMsMin'],
    ['settings45vDwellMsMax', 'shuttle45vDwellMsMax'],
    ['settings45vHallDebounceMs', 'shuttle45vHallDebounceMs'],
    ['settings45vStationLockoutMs', 'shuttle45vStationLockoutMs'],
    ['settings45vRampStepPercent', 'shuttle45vRampStepPercent'],
    ['settings45vRampStepIntervalMs', 'shuttle45vRampStepIntervalMs'],
    ['settings45vMinSpeedPercent', 'shuttle45vMinSpeedPercent'],
    ['settings45vDefaultOperatingSpeed', 'shuttle45vDefaultOperatingSpeed'],
    ['settings45vHeadlightBrightness', 'shuttle45vHeadlightBrightness'],
  ];

  const saveBtn = document.getElementById('settings45vSaveBtn');
  const saveResultEl = document.getElementById('settings45vSaveResult');

  const settings = await getJson('/api/settings');
  for (const [id, key] of fields) {
    const el = document.getElementById(id);
    if (el) el.value = settings[key] ?? '';
  }

  saveBtn.addEventListener(
    'click',
    withBusyFeedback(saveBtn, async () => {
      saveResultEl.textContent = '';
      const payload = {};
      for (const [id, key] of fields) {
        const el = document.getElementById(id);
        payload[key] = Number(el.value);
      }
      await postJson('/api/settings', payload);
      const { results } = await postJson('/api/shuttles/config/push-all', {});
      const failed = results.filter((r) => !r.ok);
      saveResultEl.textContent =
        failed.length === 0 ? `Saved, pushed to ${results.length} shuttle(s)` : `Saved, ${failed.length}/${results.length} shuttle(s) failed to sync`;
    })
  );
}

// ---------------------------------------------------------------------
// Network settings panel
// ---------------------------------------------------------------------

async function initNetworkPanel() {
  const apSsidEl = document.getElementById('netApSsid');
  const apPasswordEl = document.getElementById('netApPassword');
  const staSsidEl = document.getElementById('netStaSsid');
  const staPasswordEl = document.getElementById('netStaPassword');
  const saveBtn = document.getElementById('netSaveBtn');
  const saveResultEl = document.getElementById('netSaveResult');
  const rebootBtn = document.getElementById('netRebootBtn');
  const modeChip = document.getElementById('networkModeChip');
  const lastAppliedEl = document.getElementById('netLastApplied');

  try {
    const [config, status] = await Promise.all([getJson('/api/network/config'), getJson('/api/network/status')]);
    apSsidEl.value = config.networkApSsid || '';
    apPasswordEl.value = config.networkApPassword || '';
    staSsidEl.value = config.networkStaSsid || '';
    staPasswordEl.value = config.networkStaPassword || '';

    if (status.mode) {
      modeChip.textContent = status.mode === 'ap' ? 'AP mode' : 'Home network';
      modeChip.className = 'chip ' + (status.mode === 'ap' ? 'chip-active' : 'chip-warn');
      lastAppliedEl.textContent = `${status.ssid || '?'} @ ${new Date(status.appliedAt).toLocaleString()}${status.dryRun ? ' (dry run)' : ''}`;
    } else {
      modeChip.textContent = 'not yet applied';
    }
  } catch (err) {
    console.error(err);
    saveResultEl.textContent = `Could not load: ${err.message}`;
  }

  saveBtn.addEventListener(
    'click',
    withBusyFeedback(saveBtn, async () => {
      saveResultEl.textContent = '';
      await postJson('/api/network/config', {
        networkApSsid: apSsidEl.value.trim(),
        networkApPassword: apPasswordEl.value,
        networkStaSsid: staSsidEl.value.trim(),
        networkStaPassword: staPasswordEl.value,
      });
      saveResultEl.textContent = 'Saved -- reboot to apply.';
    })
  );

  rebootBtn.addEventListener(
    'click',
    withBusyFeedback(rebootBtn, async () => {
      if (!confirm('Reboot the Raspberry Pi now? Any trains currently running will stop.')) return;
      await postJson('/api/system/reboot', { confirm: true });
      alert('Reboot triggered. This page will disconnect shortly.');
    })
  );

  const shutdownBtn = document.getElementById('netShutdownBtn');
  shutdownBtn.addEventListener(
    'click',
    withBusyFeedback(shutdownBtn, async () => {
      if (!confirm('Shut down the Raspberry Pi completely? Unlike reboot, it will NOT come back on its own -- you\'ll need to physically power-cycle it. Continue?')) return;
      await postJson('/api/system/shutdown', { confirm: true });
      alert('Shutdown triggered. The Pi will power off shortly -- physically power-cycle it to bring it back.');
    })
  );
}

// ---------------------------------------------------------------------
// 12V track cards
// ---------------------------------------------------------------------

async function syncTrackControlState(trackId) {
  try {
    const status = await getJson(`/api/tracks-12v/${trackId}/status`);
    applyTrackStatusTelemetry(trackId, status);
  } catch (err) {
    console.warn(`Could not sync status for track ${trackId}`, err);
  }
}

const MODE_BADGE_STYLES = {
  SHUTTLE: 'badge badge-shuttle',
  CONTINUE: 'badge badge-continue',
  MANUAL: 'badge',
};

function applyTrackStatusTelemetry(trackId, { mode, commandedSlider, direction }) {
  const els = trackEls.get(trackId);
  if (!els) return;
  if (mode !== undefined) {
    if (document.activeElement !== els.modeSelect) els.modeSelect.value = mode;
    els.modeBadge.textContent = mode + (direction ? ` · ${direction === 'FORWARD' ? '\u25b8' : '\u25c2'}` : '');
    els.modeBadge.className = MODE_BADGE_STYLES[mode] || 'badge';
  }
  if (commandedSlider !== undefined && document.activeElement !== els.slider) {
    els.slider.value = commandedSlider;
    els.speedReadout.textContent = String(commandedSlider);
  }
}

function buildTracks12v(tracks, signals) {
  const grid = document.getElementById('tracks12vGrid');
  const tpl = document.getElementById('tpl-track12v');
  const zoneTpl = document.getElementById('tpl-zone-row');
  const junctionTpl = document.getElementById('tpl-junction-row');

  for (const track of tracks) {
    const node = tpl.content.firstElementChild.cloneNode(true);
    node.querySelector('.card-title').textContent = track.name;
    node.querySelector('.topology').textContent = track.topology;

    const modeBadge = node.querySelector('.mode-badge');
    const modeSelect = node.querySelector('.mode-select');
    const slider = node.querySelector('.speed-slider');
    const speedReadout = node.querySelector('.speed-readout');
    const stopBtn = node.querySelector('.stop-btn');

    modeSelect.innerHTML = '<option value="MANUAL">Manual</option><option value="CONTINUE">Continue</option><option value="SHUTTLE">Shuttle</option>';

    modeSelect.addEventListener(
      'change',
      withBusyFeedback(modeSelect, async () => {
        await postJson(`/api/tracks-12v/${track.id}/mode`, { mode: modeSelect.value });
      })
    );

    slider.addEventListener('input', () => {
      speedReadout.textContent = slider.value;
    });
    slider.addEventListener(
      'change',
      withBusyFeedback(slider, async () => {
        await postJson(`/api/tracks-12v/${track.id}/speed`, { speed: Number(slider.value) });
      })
    );

    stopBtn.addEventListener(
      'click',
      withBusyFeedback(stopBtn, async () => {
        await postJson(`/api/tracks-12v/${track.id}/stop`, {});
        slider.value = 0;
        speedReadout.textContent = '0';
      })
    );

    trackEls.set(track.id, { modeBadge, modeSelect, slider, speedReadout });

    node.querySelector('.delete-track-btn').addEventListener('click', () =>
      confirmAndDelete(`Delete "${track.name}" and everything in it (zones, sensors, signals, trains)?`, `/api/tracks-12v/${track.id}`)
    );
    node.querySelector('.add-zone-btn').addEventListener('click', () => triggerAddZone(track));
    node.querySelector('.add-train-btn').addEventListener('click', () => triggerAddTrain(track));

    const trainListEl = node.querySelector('.train-list');
    if (track.trains.length === 0) {
      trainListEl.textContent = 'No trains tagged yet.';
    } else {
      trainListEl.innerHTML = track.trains
        .map((t) => {
          const zoneName = track.zones.find((z) => z.id === t.starting_zone_id)?.name || '(no starting zone)';
          return `<span class="train-entry">${escapeHtml(t.name)} -- starts in ${escapeHtml(zoneName)}</span>`;
        })
        .join('');
    }

    const zoneList = node.querySelector('.zone-list');
    for (const zone of track.zones) {
      const zoneNode = zoneTpl.content.firstElementChild.cloneNode(true);
      zoneNode.querySelector('.zone-name').textContent = zone.name;

      const powerLed = zoneNode.querySelector('.zone-power-led');
      const occupiedChip = zoneNode.querySelector('.zone-occupied-chip');
      const speedEl = zoneNode.querySelector('.zone-speed');
      const stationChip = zoneNode.querySelector('.zone-station');

      const forceOnBtn = zoneNode.querySelector('.zone-force-on');
      const forceOffBtn = zoneNode.querySelector('.zone-force-off');
      forceOnBtn.addEventListener(
        'click',
        withBusyFeedback(forceOnBtn, () => postJson(`/api/diagnostics/zones/${zone.id}/power`, { on: true }))
      );
      forceOffBtn.addEventListener(
        'click',
        withBusyFeedback(forceOffBtn, () => postJson(`/api/diagnostics/zones/${zone.id}/power`, { on: false }))
      );

      zoneNode.querySelector('.delete-zone-btn').addEventListener('click', () =>
        confirmAndDelete(`Delete zone "${zone.name}" and its sensors?`, `/api/tracks-12v/${track.id}/zones/${zone.id}`)
      );
      zoneNode.querySelector('.add-sensor-btn').addEventListener('click', () => triggerAddSensor12v(track, zone));

      const simButtonsEl = zoneNode.querySelector('.sensor-sim-buttons');
      // End-of-line sensors are shown in the track's ends-row instead (same
      // place/labels as the 4.5V shuttle line's location sensors), not here.
      for (const sensor of zone.sensors.filter((s) => s.role !== 'end-of-line')) {
        const wrap = document.createElement('div');
        wrap.className = 'sensor-chip-group';

        const sensorRow = document.createElement('div');
        sensorRow.className = 'sensor-row';

        const sensorNumberChip = document.createElement('span');
        sensorNumberChip.className = 'sensor-number chip mono';
        sensorNumberChip.textContent = `Sensor #${sensor.sensor_number}`;
        sensorRow.appendChild(sensorNumberChip);

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'btn btn-tiny';
        btn.textContent = `Simulate ${sensor.role === 'station' ? 'station' : sensor.role === 'end-of-line' ? 'end of line' : 'entry'}`;
        btn.title = sensor.edge === 'trailing' ? 'Fires the trailing edge (back of train clears)' : 'Fires the leading edge (front of train arrives)';
        btn.addEventListener(
          'click',
          withBusyFeedback(btn, () => postJson(`/api/diagnostics/sensors/${sensor.id}/simulate`, {}))
        );
        sensorRow.appendChild(btn);

        const deleteSensorBtn = document.createElement('button');
        deleteSensorBtn.type = 'button';
        deleteSensorBtn.className = 'btn btn-tiny btn-ghost-danger';
        deleteSensorBtn.textContent = '✕';
        deleteSensorBtn.title = `Delete ${sensor.name}`;
        deleteSensorBtn.addEventListener('click', () =>
          confirmAndDelete(`Delete sensor "${sensor.name}"?`, `/api/tracks-12v/sensors/${sensor.id}`)
        );
        sensorRow.appendChild(deleteSensorBtn);

        wrap.appendChild(sensorRow);

        const attachedSignals = signals.filter((sig) => sig.sensor_id === sensor.id);
        for (const signal of attachedSignals) {
          const signalRow = document.createElement('div');
          signalRow.className = 'signal-row';

          const signalLed = document.createElement('span');
          signalLed.className = 'signal-led';
          signalLed.hidden = true;
          signalLed.title = `Signal #${signal.signal_number}`;
          signalRow.appendChild(signalLed);

          const signalChip = document.createElement('span');
          signalChip.className = 'signal-chip chip mono';
          signalChip.textContent = `Signal #${signal.signal_number}`;
          signalChip.hidden = false;
          signalRow.appendChild(signalChip);

          wrap.appendChild(signalRow);
          signalEls.set(signal.id, signalLed);
        }

        if (attachedSignals.length === 0 && (sensor.role === 'station' || sensor.role === 'end-of-line')) {
          const addSignalBtn = document.createElement('button');
          addSignalBtn.type = 'button';
          addSignalBtn.className = 'btn btn-tiny';
          addSignalBtn.textContent = '+ Signal';
          addSignalBtn.addEventListener('click', () => triggerAddSignal(sensor));
          wrap.appendChild(addSignalBtn);
        }

        simButtonsEl.appendChild(wrap);
      }

      zoneEls.set(zone.id, { row: zoneNode, powerLed, occupiedChip, speedEl, stationChip });
      zoneList.appendChild(zoneNode);
    }

    // Ends-row: only for 'length' tracks, mirrors the 4.5V shuttle line's
    // ends-row exactly (same labels, same arrival/departure buttons, same
    // junction list) -- see triggerAddEndSensor12v/triggerAddJunction12v.
    if (track.topology === 'length') {
      const endsRow = node.querySelector('.ends-row');
      endsRow.hidden = false;
      const ends = { west: {}, east: {} };
      for (const endName of ['west', 'east']) {
        const endBlock = endsRow.querySelector(`.end-block[data-end="${endName}"]`);
        const led = endBlock.querySelector('.end-led');
        const occupancyChip = endBlock.querySelector('.end-occupancy-chip');
        const sensorNameEl = endBlock.querySelector('.end-sensor-name');
        const simBtn = endBlock.querySelector('.end-sim-btn');
        const clearBtn = endBlock.querySelector('.end-clear-btn');
        const addSensorBtn = endBlock.querySelector('.add-location-sensor-btn');

        const sensor = track.zones.flatMap((z) => z.sensors).find((s) => s.role === 'end-of-line' && s.end_of_line === endName);
        if (sensor) {
          sensorNameEl.textContent = sensor.name;
          const sensorNumberChip = document.createElement('span');
          sensorNumberChip.className = 'hardware-chip chip mono';
          sensorNumberChip.textContent = `Sensor #${sensor.sensor_number}`;
          sensorNameEl.appendChild(sensorNumberChip);
          simBtn.hidden = false;
          clearBtn.hidden = false;
          addSensorBtn.hidden = true;
          simBtn.addEventListener(
            'click',
            withBusyFeedback(simBtn, () => postJson(`/api/diagnostics/sensors/${sensor.id}/simulate-arrival`, {}))
          );
          clearBtn.addEventListener(
            'click',
            withBusyFeedback(clearBtn, () => postJson(`/api/diagnostics/sensors/${sensor.id}/simulate-departure`, {}))
          );
          const deleteSensorBtn = document.createElement('button');
          deleteSensorBtn.type = 'button';
          deleteSensorBtn.className = 'btn btn-tiny btn-ghost-danger';
          deleteSensorBtn.textContent = '✕';
          deleteSensorBtn.title = `Delete ${sensor.name}`;
          deleteSensorBtn.addEventListener('click', () =>
            confirmAndDelete(`Delete sensor "${sensor.name}"?`, `/api/tracks-12v/sensors/${sensor.id}`)
          );
          sensorNameEl.appendChild(deleteSensorBtn);
        } else {
          sensorNameEl.textContent = '(no sensor configured)';
          simBtn.hidden = true;
          clearBtn.hidden = true;
          addSensorBtn.hidden = false;
          addSensorBtn.addEventListener('click', () => triggerAddEndSensor12v(track, endName));
        }

        const junctionListEl = endBlock.querySelector('.junction-list');
        const junctions = (track.junctions || []).filter((j) => j.end === endName);
        for (const junction of junctions) {
          const jNode = junctionTpl.content.firstElementChild.cloneNode(true);
          jNode.querySelector('.junction-name').textContent = junction.name;
          const positionChip = jNode.querySelector('.junction-position');
          const throwA = jNode.querySelector('.junction-throw-a');
          const throwB = jNode.querySelector('.junction-throw-b');
          throwA.addEventListener(
            'click',
            withBusyFeedback(throwA, () => postJson(`/api/diagnostics/junctions/${junction.id}/throw`, { direction: 'a' }))
          );
          throwB.addEventListener(
            'click',
            withBusyFeedback(throwB, () => postJson(`/api/diagnostics/junctions/${junction.id}/throw`, { direction: 'b' }))
          );
          const driverChip = document.createElement('span');
          driverChip.className = 'junction-driver chip mono';
          driverChip.textContent = `Driver ${junction.driver_number}, Ch ${junction.driver_channel}`;
          jNode.querySelector('.junction-actions').prepend(driverChip);

          const deleteJunctionBtn = document.createElement('button');
          deleteJunctionBtn.type = 'button';
          deleteJunctionBtn.className = 'btn btn-tiny btn-ghost-danger';
          deleteJunctionBtn.textContent = '✕';
          deleteJunctionBtn.title = `Delete ${junction.name}`;
          deleteJunctionBtn.addEventListener('click', () =>
            confirmAndDelete(`Delete junction "${junction.name}"?`, `/api/tracks-12v/junctions/${junction.id}`)
          );
          jNode.querySelector('.junction-actions').appendChild(deleteJunctionBtn);
          junctionEls.set(junction.id, { positionChip });
          junctionListEl.appendChild(jNode);
        }
        endBlock.querySelector('.add-junction-btn').addEventListener('click', () => triggerAddJunction12v(track, endName));

        ends[endName] = { led, occupancyChip };
      }
      shuttleTrackEls.set(track.id, ends);
    }

    grid.appendChild(node);
  }
}

// ---------------------------------------------------------------------
// 4.5V shuttle line cards
// ---------------------------------------------------------------------

function buildTracks45v(tracks, allShuttles) {
  const grid = document.getElementById('tracks45vGrid');
  const tpl = document.getElementById('tpl-track45v');
  const junctionTpl = document.getElementById('tpl-junction-row');
  const shuttleTpl = document.getElementById('tpl-shuttle-block');

  for (const track of tracks) {
    const node = tpl.content.firstElementChild.cloneNode(true);
    node.querySelector('.card-title').textContent = track.name;
    node.querySelector('.delete-track-btn').addEventListener('click', () =>
      confirmAndDelete(`Delete "${track.name}" and everything in it (sensors, junctions)?`, `/api/tracks-45v/${track.id}`)
    );

    const ends = { west: {}, east: {} };
    for (const endName of ['west', 'east']) {
      const endBlock = node.querySelector(`.end-block[data-end="${endName}"]`);
      const led = endBlock.querySelector('.end-led');
      const occupancyChip = endBlock.querySelector('.end-occupancy-chip');
      const sensorNameEl = endBlock.querySelector('.end-sensor-name');
      const simBtn = endBlock.querySelector('.end-sim-btn');
      const clearBtn = endBlock.querySelector('.end-clear-btn');
      const addSensorBtn = endBlock.querySelector('.add-location-sensor-btn');

      const sensor = track.sensors.find((s) => s.end_of_line === endName);
      if (sensor) {
        sensorNameEl.textContent = sensor.name;
        const sensorNumberChip = document.createElement('span');
        sensorNumberChip.className = 'hardware-chip chip mono';
        sensorNumberChip.textContent = `Sensor #${sensor.sensor_number}`;
        sensorNameEl.appendChild(sensorNumberChip);
        const hasAssignedShuttle = track.shuttles.length > 0;
        simBtn.hidden = !hasAssignedShuttle;
        clearBtn.hidden = !hasAssignedShuttle;
        addSensorBtn.hidden = true;
        if (hasAssignedShuttle) {
          simBtn.addEventListener(
            'click',
            withBusyFeedback(simBtn, () => postJson(`/api/diagnostics/shuttle-sensors/${sensor.id}/simulate`, {}))
          );
          clearBtn.addEventListener(
            'click',
            withBusyFeedback(clearBtn, () => postJson(`/api/diagnostics/shuttle-sensors/${sensor.id}/simulate-clear`, {}))
          );
        }
        const deleteSensorBtn = document.createElement('button');
        deleteSensorBtn.type = 'button';
        deleteSensorBtn.className = 'btn btn-tiny btn-ghost-danger';
        deleteSensorBtn.textContent = '✕';
        deleteSensorBtn.title = `Delete ${sensor.name}`;
        deleteSensorBtn.addEventListener('click', () =>
          confirmAndDelete(`Delete sensor "${sensor.name}"?`, `/api/tracks-45v/sensors/${sensor.id}`)
        );
        sensorNameEl.appendChild(deleteSensorBtn);
      } else {
        sensorNameEl.textContent = '(no sensor configured)';
        simBtn.hidden = true;
        clearBtn.hidden = true;
        addSensorBtn.hidden = false;
        addSensorBtn.addEventListener('click', () => triggerAddLocationSensor(track, endName));
      }

      const junctionListEl = endBlock.querySelector('.junction-list');
      const junctions = track.junctions.filter((j) => j.end === endName);
      for (const junction of junctions) {
        const jNode = junctionTpl.content.firstElementChild.cloneNode(true);
        jNode.querySelector('.junction-name').textContent = junction.name;
        const positionChip = jNode.querySelector('.junction-position');
        const throwA = jNode.querySelector('.junction-throw-a');
        const throwB = jNode.querySelector('.junction-throw-b');
        throwA.addEventListener(
          'click',
          withBusyFeedback(throwA, () => postJson(`/api/diagnostics/junctions/${junction.id}/throw`, { direction: 'a' }))
        );
        throwB.addEventListener(
          'click',
          withBusyFeedback(throwB, () => postJson(`/api/diagnostics/junctions/${junction.id}/throw`, { direction: 'b' }))
        );
        const driverChip = document.createElement('span');
        driverChip.className = 'junction-driver chip mono';
        driverChip.textContent = `Driver ${junction.driver_number}, Ch ${junction.driver_channel}`;
        jNode.querySelector('.junction-actions').prepend(driverChip);

        const deleteJunctionBtn = document.createElement('button');
        deleteJunctionBtn.type = 'button';
        deleteJunctionBtn.className = 'btn btn-tiny btn-ghost-danger';
        deleteJunctionBtn.textContent = '✕';
        deleteJunctionBtn.title = `Delete ${junction.name}`;
        deleteJunctionBtn.addEventListener('click', () =>
          confirmAndDelete(`Delete junction "${junction.name}"?`, `/api/tracks-45v/junctions/${junction.id}`)
        );
        jNode.querySelector('.junction-actions').appendChild(deleteJunctionBtn);
        junctionEls.set(junction.id, { positionChip });
        junctionListEl.appendChild(jNode);
      }
      endBlock.querySelector('.add-junction-btn').addEventListener('click', () => triggerAddJunction(track, endName));

      ends[endName] = { led, occupancyChip };
    }
    shuttleTrackEls.set(track.id, ends);

    const shuttleListEl = node.querySelector('.shuttle-list');
    if (track.shuttles.length === 0) {
      const emptyNotice = document.createElement('div');
      emptyNotice.className = 'mono shuttle-empty-state';
      emptyNotice.textContent = 'No shuttle assigned — register the 4.5V train and assign it to this line.';
      shuttleListEl.appendChild(emptyNotice);
    } else {
      for (const shuttle of track.shuttles) {
        shuttleListEl.appendChild(buildShuttleBlock(shuttle, shuttleTpl));
      }
    }

    const unassigned = allShuttles.filter((s) => !s.shuttle_track_id);
    const assignRow = node.querySelector('.assign-row');
    if (unassigned.length > 0) {
      assignRow.hidden = false;
      const select = assignRow.querySelector('.assign-select');
      select.innerHTML = unassigned.map((s) => `<option value="${s.id}">${escapeHtml(s.display_name)} (${s.ip_address})</option>`).join('');
      const btn = assignRow.querySelector('.assign-btn');
      btn.addEventListener(
        'click',
        withBusyFeedback(btn, async () => {
          await postJson(`/api/shuttles/${select.value}/assign-track`, { shuttleTrackId: track.id });
          window.location.reload();
        })
      );
    }

    grid.appendChild(node);
  }
}

function buildUnassignedShuttles(tracks45v, allShuttles) {
  const unassigned = allShuttles.filter((s) => !s.shuttle_track_id);
  if (unassigned.length === 0) return;
  document.getElementById('section-unassigned').hidden = false;
  const grid = document.getElementById('unassignedGrid');
  const shuttleTpl = document.getElementById('tpl-shuttle-block');
  const card = document.createElement('article');
  card.className = 'card';
  for (const shuttle of unassigned) {
    card.appendChild(buildShuttleBlock(shuttle, shuttleTpl));
  }
  grid.appendChild(card);
}

function buildShuttleBlock(shuttle, shuttleTpl) {
  const node = shuttleTpl.content.firstElementChild.cloneNode(true);
  const onlineLed = node.querySelector('.shuttle-online-led');
  const nameInput = node.querySelector('.shuttle-name-input');
  const renameBtn = node.querySelector('.shuttle-rename-btn');
  const telemetry = node.querySelector('.shuttle-telemetry');
  const modeSelect = node.querySelector('.shuttle-mode-select');
  const slider = node.querySelector('.shuttle-speed-slider');
  const speedReadout = node.querySelector('.speed-readout');
  const headlightsToggle = node.querySelector('.shuttle-headlights-toggle');
  const stopBtn = node.querySelector('.shuttle-stop-btn');

  nameInput.value = shuttle.display_name;
  telemetry.textContent = shuttle.ip_address;
  const headlightsState = !!(shuttle.runtime?.headlights ?? shuttle.runtime?.headlightOn ?? shuttle.runtime?.enabled ?? false);
  headlightsToggle.checked = headlightsState;

  nameInput.addEventListener('input', () => {
    renameBtn.hidden = nameInput.value.trim() === shuttle.display_name;
  });
  renameBtn.addEventListener(
    'click',
    withBusyFeedback(renameBtn, async () => {
      await postJson(`/api/shuttles/${shuttle.id}/rename`, { displayName: nameInput.value.trim() });
      shuttle.display_name = nameInput.value.trim();
      renameBtn.hidden = true;
    })
  );

  modeSelect.addEventListener(
    'change',
    withBusyFeedback(modeSelect, () => postJson(`/api/shuttles/${shuttle.id}/mode`, { mode: modeSelect.value }))
  );
  slider.addEventListener('input', () => {
    speedReadout.textContent = slider.value;
  });
  slider.addEventListener(
    'change',
    withBusyFeedback(slider, () => postJson(`/api/shuttles/${shuttle.id}/speed`, { speed: Number(slider.value) }))
  );
  headlightsToggle.addEventListener(
    'change',
    withBusyFeedback(headlightsToggle, async () => {
      const enabled = headlightsToggle.checked;
      const result = await postJson(`/api/shuttles/${shuttle.id}/headlights`, { enabled });
      const nextState = !!(result.enabled ?? result.on ?? result.headlights ?? enabled);
      headlightsToggle.checked = nextState;
      shuttle.runtime = { ...(shuttle.runtime || {}), headlights: nextState };
    })
  );

  stopBtn.addEventListener(
    'click',
    withBusyFeedback(stopBtn, async () => {
      await postJson(`/api/shuttles/${shuttle.id}/stop`, {});
      slider.value = 0;
      speedReadout.textContent = '0';
    })
  );

  shuttleEls.set(shuttle.id, { onlineLed, telemetry, modeSelect, slider, speedReadout, nameInput, ipAddress: shuttle.ip_address });
  return node;
}

// ---------------------------------------------------------------------
// Escaping (option labels use raw display names)
// ---------------------------------------------------------------------

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ---------------------------------------------------------------------
// Telemetry application (from websocket / initial snapshot)
// ---------------------------------------------------------------------

function applySnapshot(runtime) {
  if (!runtime) return;

  for (const [trackId, trackState] of Object.entries(runtime.tracks12v || {})) {
    for (const [zoneId, zoneState] of Object.entries(trackState.zones || {})) {
      applyZoneTelemetry(trackId, zoneId, zoneState);
    }
    if (trackState.mode !== undefined) applyTrackStatusTelemetry(trackId, trackState);
    applyShuttleTrackTelemetry(trackId, trackState);
  }
  for (const [shuttleTrackId, trackState] of Object.entries(runtime.shuttleTracks || {})) {
    applyShuttleTrackTelemetry(shuttleTrackId, trackState);
  }
  for (const [shuttleId, shuttleState] of Object.entries(runtime.shuttles || {})) {
    applyShuttleTelemetry(shuttleId, shuttleState);
  }
  for (const [junctionId, junctionState] of Object.entries(runtime.junctions || {})) {
    applyJunctionTelemetry(junctionId, junctionState);
  }
  for (const [signalId, signalState] of Object.entries(runtime.signals || {})) {
    applySignalTelemetry(signalId, signalState);
  }
}

function applyZoneTelemetry(trackId, zoneId, zone) {
  const els = zoneEls.get(zoneId);
  if (!els || !zone) return;

  els.powerLed.className = 'led zone-power-led ' + (zone.powered ? 'on-green' : '');

  const occupied = zone.occupied ? 'occupied' : 'clear';
  const speedText = `${zone.appliedSpeed ?? 0}%`;
  const station = (zone.stationAction || 'none') === 'none' ? 'idle' : zone.stationAction;

  els.occupiedChip.textContent = occupied;
  els.occupiedChip.className = 'zone-occupied-chip chip' + (zone.occupied ? ' chip-active' : '');
  els.speedEl.textContent = speedText;
  els.stationChip.textContent = station;
  els.stationChip.className = 'zone-station chip' + (station !== 'idle' ? ' chip-warn' : '');
}

function applyShuttleTrackTelemetry(shuttleTrackId, trackState) {
  const ends = shuttleTrackEls.get(shuttleTrackId);
  if (!ends || !trackState) return;
  const lastKnownEnd = trackState.lastKnownEnd || 'unknown';
  const occupiedEnd = trackState.occupiedEnd ?? null;

  for (const endName of ['west', 'east']) {
    const { led, occupancyChip } = ends[endName];
    // LED reflects LIVE occupancy (on while the sensor is actually
    // blocked -- i.e. the shuttle is physically sitting there right now),
    // not just "last known," so it correctly turns off once the shuttle
    // pulls away.
    led.className = 'led end-led' + (occupiedEnd === endName ? ' on-accent' : '');
    if (occupiedEnd === endName) {
      occupancyChip.textContent = 'here now';
      occupancyChip.className = 'end-occupancy-chip chip chip-active';
    } else if (lastKnownEnd === endName) {
      occupancyChip.textContent = 'last seen';
      occupancyChip.className = 'end-occupancy-chip chip chip-muted';
    } else {
      occupancyChip.textContent = '';
      occupancyChip.className = 'end-occupancy-chip chip';
    }
  }
}

function applyShuttleTelemetry(shuttleId, shuttleState) {
  const els = shuttleEls.get(shuttleId);
  if (!els || !shuttleState) return;
  els.onlineLed.className = 'led shuttle-online-led ' + (shuttleState.online ? 'on-green' : '');
  const lastKnown = shuttleState.lastKnown;
  const parts = [els.ipAddress];
  if (lastKnown) {
    parts.push(`mode=${lastKnown.mode ?? '?'}`, `applied=${lastKnown.appliedSpeed ?? '?'}%`);
    if (document.activeElement !== els.modeSelect && lastKnown.mode) els.modeSelect.value = lastKnown.mode;
    if (document.activeElement !== els.slider && typeof lastKnown.commandedSlider === 'number') {
      els.slider.value = lastKnown.commandedSlider;
      els.speedReadout.textContent = String(lastKnown.commandedSlider);
    }
  }
  els.telemetry.textContent = parts.join(' · ');
}

function applyJunctionTelemetry(junctionId, junction) {
  const els = junctionEls.get(junctionId);
  if (!els || !junction) return;
  const position = junction.moving ? 'moving' : junction.position || 'unknown';
  els.positionChip.textContent = position;
  els.positionChip.className = 'junction-position chip' + (junction.moving ? ' chip-warn' : position === 'diverging' ? ' chip-active' : '');
}

function applySignalTelemetry(signalId, signal) {
  const el = signalEls.get(signalId);
  if (!el || !signal) return;
  el.hidden = false;
  el.className = 'signal-led' + (signal.aspect === 'green' ? ' aspect-green' : signal.aspect === 'red' ? ' aspect-red' : '');
}

// ---------------------------------------------------------------------
// WebSocket (live updates)
// ---------------------------------------------------------------------

let reconnectDelayMs = 1000;

function connectWebSocket() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const ws = new WebSocket(`${proto}//${location.host}/ws`);
  const led = document.getElementById('wsLed');
  const label = document.getElementById('wsLabel');

  ws.addEventListener('open', () => {
    reconnectDelayMs = 1000;
    led.className = 'led on-green';
    label.textContent = 'live';
  });

  ws.addEventListener('close', () => {
    led.className = 'led';
    label.textContent = 'reconnecting…';
    setTimeout(connectWebSocket, reconnectDelayMs);
    reconnectDelayMs = Math.min(reconnectDelayMs * 1.6, 15000);
  });

  ws.addEventListener('error', () => ws.close());

  ws.addEventListener('message', (event) => {
    let msg;
    try {
      msg = JSON.parse(event.data);
    } catch {
      return;
    }
    const { topic, payload } = msg;
    if (topic === 'snapshot') applySnapshot(payload);
    else if (topic === 'track12v') applyZoneTelemetry(payload.trackId, payload.zoneId, payload.zone);
    else if (topic === 'track12vStatus') applyTrackStatusTelemetry(payload.trackId, payload);
    else if (topic === 'shuttleTrack') applyShuttleTrackTelemetry(payload.shuttleTrackId, payload.track);
    else if (topic === 'track12vEnd') applyShuttleTrackTelemetry(payload.trackId, payload.track);
    else if (topic === 'shuttle') applyShuttleTelemetry(payload.shuttleId, payload.shuttle);
    else if (topic === 'junction') applyJunctionTelemetry(payload.junctionId, payload.junction);
    else if (topic === 'signal') applySignalTelemetry(payload.signalId, payload.signal);
  });
}

boot();
