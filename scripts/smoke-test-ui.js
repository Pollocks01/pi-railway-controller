'use strict';

// One-off smoke test: loads the actual served page into jsdom, executes
// app.js for real, and reports any uncaught errors or obviously-missing
// elements. Not a permanent part of the project -- just a way to verify
// the UI's JS runs cleanly without a real browser available.

const { JSDOM, VirtualConsole } = require('jsdom');
const nodeFetch = require('node-fetch');

async function main() {
  const base = 'http://localhost:4001';
  const virtualConsole = new VirtualConsole();
  const errors = [];
  virtualConsole.on('jsdomError', (e) => errors.push(`jsdomError: ${e.message}\n${e.stack || ''}`));
  virtualConsole.on('error', (...args) => errors.push(`console.error: ${args.join(' ')}`));

  const html = await (await nodeFetch(`${base}/`)).text();

  const dom = new JSDOM(html, {
    url: `${base}/`,
    runScripts: 'dangerously',
    resources: 'usable',
    virtualConsole,
    pretendToBeVisual: true,
    beforeParse(window) {
      // jsdom doesn't ship fetch/WebSocket -- polyfill with the same
      // capability a real browser would have, before any <script> runs.
      window.fetch = (url, opts) => nodeFetch(new URL(url, base).toString(), opts);
      window.WebSocket = class {
        constructor() {
          this.readyState = 0;
        }
        addEventListener() {}
        close() {}
      };
    },
  });

  // Wait for boot()'s async fetch chain to settle.
  await new Promise((resolve) => setTimeout(resolve, 2000));

  const doc = dom.window.document;
  console.log('title:', doc.title);
  console.log('body length:', doc.body ? doc.body.innerHTML.length : 'NO BODY');
  console.log('emptyState element:', doc.getElementById('emptyState'));

  const checks = {
    'track card rendered': doc.querySelectorAll('.card-loop').length,
    'zone rows rendered': doc.querySelectorAll('.zone-row').length,
    'shuttle line card rendered': doc.querySelectorAll('.card-shuttle-line').length,
    'junction rows rendered': doc.querySelectorAll('.junction-row').length,
    'sensor numbers visible': [...doc.querySelectorAll('.sensor-number')].some((el) => el.textContent.includes('#')),
    'signal numbers visible': [...doc.querySelectorAll('.signal-chip')].some((el) => el.textContent.includes('#')),
    'junction hardware info visible': [...doc.querySelectorAll('.junction-driver')].some((el) => el.textContent.includes('Driver')),
    'gpio mode label set': doc.getElementById('gpioModeLabel')?.textContent,
    'empty state hidden': doc.getElementById('emptyState')?.hidden,
  };

  console.log('--- checks ---');
  for (const [k, v] of Object.entries(checks)) console.log(`${k}: ${JSON.stringify(v)}`);

  console.log('--- errors (render phase) ---');
  if (errors.length === 0) console.log('(none)');
  else errors.forEach((e) => console.log(e));

  // Exercise a real control: flip the first track's mode select to CONTINUE
  // and confirm the resulting API call actually lands (via the mock GPIO
  // log on the server side is out of scope here; we just confirm the
  // browser-side event handler fires without throwing and the fetch
  // resolves with ok:true).
  const modeSelect = doc.querySelector('.mode-select');
  if (modeSelect) {
    modeSelect.value = 'CONTINUE';
    modeSelect.dispatchEvent(new dom.window.Event('change'));
    await new Promise((resolve) => setTimeout(resolve, 500));
    console.log('mode select after interaction:', modeSelect.value, modeSelect.disabled);
  } else {
    console.log('no mode select found to exercise');
  }

  console.log('--- errors (after mode interaction) ---');
  if (errors.length === 0) console.log('(none)');
  else errors.forEach((e) => console.log(e));

  const slider = doc.querySelector('.speed-slider');
  if (slider) {
    slider.value = 55;
    slider.dispatchEvent(new dom.window.Event('input'));
    slider.dispatchEvent(new dom.window.Event('change'));
    await new Promise((resolve) => setTimeout(resolve, 500));
    console.log('slider after interaction:', slider.value, slider.disabled, 'readout=', doc.querySelector('.speed-readout').textContent);
  }

  const forceOnBtn = doc.querySelector('.zone-force-on');
  if (forceOnBtn) {
    forceOnBtn.dispatchEvent(new dom.window.Event('click'));
    await new Promise((resolve) => setTimeout(resolve, 500));
    console.log('force-on button after interaction:', forceOnBtn.textContent, forceOnBtn.disabled);
  }

  console.log('--- errors (final) ---');
  if (errors.length === 0) console.log('(none)');
  else errors.forEach((e) => console.log(e));

  // Network panel: confirm it loaded values and a save round-trips.
  const apSsidInput = doc.getElementById('netApSsid');
  const saveBtn = doc.getElementById('netSaveBtn');
  const saveResult = doc.getElementById('netSaveResult');
  console.log('network AP SSID loaded as:', apSsidInput?.value);
  if (apSsidInput && saveBtn) {
    apSsidInput.value = 'SmokeTestSSID';
    apSsidInput.dispatchEvent(new dom.window.Event('input'));
    saveBtn.dispatchEvent(new dom.window.Event('click'));
    await new Promise((resolve) => setTimeout(resolve, 500));
    console.log('save result text:', saveResult.textContent);
  }

  console.log('--- errors (after network panel interaction) ---');
  if (errors.length === 0) console.log('(none)');
  else errors.forEach((e) => console.log(e));

  dom.window.close();
  process.exit(errors.length > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
