'use strict';

// Exercises the "+  Add X" authoring flows through real DOM events (not
// just hitting the API directly) to prove the modal wiring, inventory
// dropdowns, and form submission all work end-to-end. Since a successful
// submit triggers `window.location.reload()`, we stub `location.reload`
// to a no-op and instead re-fetch the config API ourselves afterward to
// confirm the change actually landed server-side.

const { JSDOM, VirtualConsole } = require('jsdom');
const nodeFetch = require('node-fetch');

async function main() {
  const base = 'http://localhost:4001';
  const virtualConsole = new VirtualConsole();
  const errors = [];
  virtualConsole.on('jsdomError', (e) => {
    if (e.message.includes('Not implemented: navigation')) return; // expected -- location.reload() has no jsdom implementation
    errors.push(`jsdomError: ${e.message}`);
  });
  virtualConsole.on('error', (...args) => errors.push(`console.error: ${args.join(' ')}`));

  const html = await (await nodeFetch(`${base}/`)).text();

  const dom = new JSDOM(html, {
    url: `${base}/`,
    runScripts: 'dangerously',
    resources: 'usable',
    virtualConsole,
    pretendToBeVisual: true,
    beforeParse(window) {
      window.fetch = (url, opts) => nodeFetch(new URL(url, base).toString(), opts);
      window.WebSocket = class {
        constructor() { this.readyState = 0; }
        addEventListener() {}
        close() {}
      };
      window.confirm = () => true;
      window.alert = (msg) => console.log('[alert]', msg);
    },
  });

  await new Promise((resolve) => setTimeout(resolve, 1500));
  const doc = dom.window.document;
  const win = dom.window;

  function fillAndSubmit(fieldValues) {
    const form = doc.getElementById('modalForm');
    for (const [name, value] of Object.entries(fieldValues)) {
      const el = form.querySelector(`[name="${name}"]`);
      if (!el) throw new Error(`field '${name}' not found in modal form`);
      el.value = value;
    }
    form.dispatchEvent(new win.Event('submit', { bubbles: true, cancelable: true }));
  }

  // --- Add a 12V loop -----------------------------------------------
  doc.getElementById('addTrack12vBtn').dispatchEvent(new win.Event('click'));
  await new Promise((r) => setTimeout(r, 200));
  console.log('modal open for add-track12v:', !doc.getElementById('modalOverlay').hidden);
  fillAndSubmit({ name: 'Test Loop From Smoke Test', topology: 'loop' });
  await new Promise((r) => setTimeout(r, 500));

  const tracksAfterAdd = await (await nodeFetch(`${base}/api/tracks-12v`)).json();
  const newTrack = tracksAfterAdd.find((t) => t.name === 'Test Loop From Smoke Test');
  console.log('new 12V track created server-side:', !!newTrack, newTrack?.id);

  if (!newTrack) throw new Error('12V track was not actually created');

  // --- Add a zone to it (via direct API since the new card isn't in this
  // already-rendered DOM -- the modal wiring itself was already proven
  // above; this just confirms the zone-add endpoint + inventory numbers
  // are consistent) -----------------------------------------------------
  const inventoryBefore = await (await nodeFetch(`${base}/api/inventory`)).json();
  console.log('available zone drivers before add:', inventoryBefore.availableZoneDrivers);

  // --- Add Zone flow (uses the existing seeded track's card, tests the
  // async inventory-populated driver-number <select>) --------------------
  const addZoneBtn = doc.querySelector('.add-zone-btn');
  addZoneBtn.dispatchEvent(new win.Event('click'));
  await new Promise((r) => setTimeout(r, 400)); // inventory fetch is async
  const driverSelect = doc.querySelector('#modalForm [name="driverNumber"]');
  console.log('driver select options:', Array.from(driverSelect.options).map((o) => o.value));
  fillAndSubmit({ name: 'Smoke Test Zone', sequenceIndex: '5', driverNumber: driverSelect.options[0].value });
  await new Promise((r) => setTimeout(r, 500));

  const tracksAfterZoneAdd = await (await nodeFetch(`${base}/api/tracks-12v`)).json();
  const zoneAdded = tracksAfterZoneAdd.some((t) => t.zones.some((z) => z.name === 'Smoke Test Zone'));
  console.log('zone actually created server-side:', zoneAdded);
  if (!zoneAdded) throw new Error('zone was not created via the Add Zone modal flow');

  // Clean up the zone we just added.
  const trackWithZone = tracksAfterZoneAdd.find((t) => t.zones.some((z) => z.name === 'Smoke Test Zone'));
  const zoneToDelete = trackWithZone.zones.find((z) => z.name === 'Smoke Test Zone');
  const zoneDelRes = await nodeFetch(`${base}/api/tracks-12v/${trackWithZone.id}/zones/${zoneToDelete.id}`, { method: 'DELETE' });
  console.log('zone cleanup delete status:', zoneDelRes.status);

  // --- Delete the test track to leave the DB clean ----------------------
  const delRes = await nodeFetch(`${base}/api/tracks-12v/${newTrack.id}`, { method: 'DELETE' });
  console.log('cleanup delete status:', delRes.status);

  // --- Simulate arrival/departure on the seeded shuttle line's west end,
  // via a real button click. Note: this harness stubs WebSocket as a
  // no-op, so the DOM won't visually update the way a real browser would
  // (that's proven separately via direct API checks) -- what this DOES
  // prove is that the button is wired to the right endpoint and the
  // server-side state actually changes as a result.
  const shuttleTrack = (await (await nodeFetch(`${base}/api/tracks-45v`)).json())[0];
  const westSensor = shuttleTrack.sensors.find((s) => s.end_of_line === 'west');

  // Scoped to #tracks45vGrid: 12V 'length' tracks now render an
  // identically-classed .end-block (same UI parity as the 4.5V shuttle
  // line), so an unscoped selector would ambiguously match either.
  const shuttleGrid = doc.getElementById('tracks45vGrid');
  const westSimBtn = shuttleGrid.querySelector('.end-block[data-end="west"] .end-sim-btn');
  const westClearBtn = shuttleGrid.querySelector('.end-block[data-end="west"] .end-clear-btn');

  westSimBtn.dispatchEvent(new win.Event('click'));
  await new Promise((r) => setTimeout(r, 400));
  let status = await (await nodeFetch(`${base}/api/status`)).json();
  console.log('after arrival click -- server state:', status.runtime.shuttleTracks[shuttleTrack.id]);
  if (status.runtime.shuttleTracks[shuttleTrack.id]?.occupiedEnd !== 'west') {
    throw new Error('clicking Simulate arrival did not set occupiedEnd=west server-side');
  }

  westClearBtn.dispatchEvent(new win.Event('click'));
  await new Promise((r) => setTimeout(r, 400));
  status = await (await nodeFetch(`${base}/api/status`)).json();
  console.log('after departure click -- server state:', status.runtime.shuttleTracks[shuttleTrack.id]);
  if (status.runtime.shuttleTracks[shuttleTrack.id]?.occupiedEnd !== null) {
    throw new Error('clicking Simulate departure did not clear occupiedEnd server-side');
  }
  if (status.runtime.shuttleTracks[shuttleTrack.id]?.lastKnownEnd !== 'west') {
    throw new Error('lastKnownEnd should still be "west" after departure -- it must persist through a clear');
  }
  console.log(`sensor used: ${westSensor.name} (id ${westSensor.id})`);

  console.log('--- errors ---');
  if (errors.length === 0) console.log('(none)');
  else errors.forEach((e) => console.log(e));

  dom.window.close();
  process.exit(errors.length > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
