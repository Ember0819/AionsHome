const assert = require('node:assert/strict');
const { test } = require('node:test');
const { populate } = require('./static/tts-voices.js');

function selectElement() {
  const doc = { createElement: tag => ({ tag, children: [], appendChild(n) { this.children.push(n); } }) };
  return {
    ...doc.createElement('select'), ownerDocument: doc,
    replaceChildren() { this.children = []; },
    get options() { return this.children.flatMap(n => n.tag === 'optgroup' ? n.children : [n]); },
  };
}
const voices = [
  { uri: 'speech:existing', customName: '原来的声音' },
  { uri: 'edge:zh-CN-XiaoxiaoNeural', customName: 'Edge 免费 · 晓晓 · 女声' },
];

test('chat/theater picker keeps either saved route and labels both', () => {
  const select = selectElement();
  for (const voice of voices) {
    assert.equal(populate(select, voices, voice.uri), voice.uri);
  }
  assert.deepEqual(select.children.map(n => n.label), ['硅基流动', 'Edge 免费']);
  assert.equal(select.options[1].textContent, 'Edge 免费 · 晓晓 · 女声');
});

test('provider outage does not silently switch the saved route', () => {
  const select = selectElement();
  assert.equal(populate(select, [voices[1]], voices[0].uri), voices[0].uri);
  assert.equal(select.options.length, 2);
  assert.equal(populate(select, [voices[1]], ''), voices[1].uri);
});

test('removing a free favorite clears the selection without choosing a paid voice', () => {
  const select = selectElement();
  assert.equal(populate(select, [voices[0]], voices[1].uri), '');
  assert.equal(select.options.length, 2);
});
