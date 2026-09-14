const { test } = require('node:test');
const assert = require('node:assert/strict');
const { initTtsLoudnessSettings } = require('./static/tts-loudness-settings.js');

function openSettings(bridge) {
  const elements = Object.fromEntries(['ttsLoudnessInput', 'ttsLoudnessValue', 'ttsLoudnessStatus'].map(id => [id, {
    value: '0', disabled: true, textContent: '', listeners: {},
    setAttribute() {},
    addEventListener(type, handler) { this.listeners[type] = handler; },
  }]));
  initTtsLoudnessSettings({ AionTtsAudio: bridge, document: { getElementById: id => elements[id] } });
  return { input: elements.ttsLoudnessInput, output: elements.ttsLoudnessValue, status: elements.ttsLoudnessStatus };
}

test('drag previews, release saves, reopening restores, and zero disables enhancement', () => {
  let stored = 0;
  let writes = 0;
  const bridge = { getLoudnessGainDb: () => stored, setLoudnessGainDb(value) { writes++; return stored = value; } };
  let ui = openSettings(bridge);
  assert.equal(ui.input.disabled, false);
  assert.equal(ui.input.value, '0');
  ui.input.value = '30';
  ui.input.listeners.input();
  assert.equal(ui.output.textContent, '+30 dB');
  assert.equal(writes, 0);
  ui.input.listeners.change();
  assert.equal(stored, 30);
  assert.match(ui.status.textContent, /已保存/);
  ui = openSettings(bridge);
  assert.equal(ui.input.value, '30');
  ui.input.value = '0';
  ui.input.listeners.change();
  assert.equal(stored, 0);
  assert.match(ui.output.textContent, /关闭/);
});

test('older apps and browsers cannot misleadingly save an unsupported setting', () => {
  for (const bridge of [undefined, { play() {} }]) {
    const ui = openSettings(bridge);
    assert.equal(ui.input.disabled, true);
    assert.equal(ui.input.listeners.change, undefined);
  }
});

test('a failed bridge save is reported as a failure', () => {
  const ui = openSettings({ getLoudnessGainDb: () => 3, setLoudnessGainDb() { throw new Error('unavailable'); } });
  ui.input.value = '9';
  ui.input.listeners.change();
  assert.match(ui.status.textContent, /保存失败/);
});
