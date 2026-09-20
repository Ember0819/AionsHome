const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function setup({ saver, response = new Response(new Blob(['original-image'], { type: 'image/png' })) } = {}) {
  const source = fs.readFileSync(path.join(__dirname, 'static/album.js'), 'utf8');
  const nodes = {
    downloadLink: { textContent: '下载', setAttribute() {}, removeAttribute() {} },
    viewerMessage: { textContent: '' },
    photoDialog: { open: true },
  };
  const photo = { id: 'photo-1', filename: 'photo-1.png', url: '/uploads/album/photo-1.png' };
  const requests = [];
  const window = { parent: { AionImageSaver: saver }, top: {} };
  class FileReader {
    readAsDataURL(blob) {
      blob.arrayBuffer().then(bytes => {
        this.result = `data:${blob.type};base64,${Buffer.from(bytes).toString('base64')}`;
        this.onload();
      });
    }
  }
  const context = vm.createContext({
    $: id => nodes[id], window, FileReader, state: {}, current: () => photo,
    fetch: async url => { requests.push(url); return response; },
  });
  const handler = source.match(/  \$\('downloadLink'\)\.onclick = async event => \{[\s\S]*?\n  \};/);
  if (handler) vm.runInContext(handler[0], context);
  let prevented = false;
  return {
    nodes, requests,
    click: () => nodes.downloadLink.onclick?.({ preventDefault() { prevented = true; } }),
    prevented: () => prevented,
  };
}

test('APK album download saves original bytes and filename through the native gallery bridge', async () => {
  const saved = [];
  const app = setup({ saver: { save: (...args) => saved.push(args) } });
  await app.click();
  assert.equal(app.prevented(), true, 'APK must stop the unsupported attachment navigation');
  assert.deepEqual(app.requests, ['/api/album/photos/photo-1/download']);
  assert.deepEqual(saved, [['b3JpZ2luYWwtaW1hZ2U=', 'photo-1.png']]);
  assert.equal(app.nodes.downloadLink.textContent, '下载');
});

test('ordinary browsers retain the existing download link without invoking the native flow', async () => {
  const app = setup();
  await app.click();
  assert.equal(app.prevented(), false);
  assert.deepEqual(app.requests, []);
});

test('failed original download is reported and can be retried without saving an error response', async () => {
  const saved = [];
  const app = setup({ saver: { save: (...args) => saved.push(args) }, response: new Response('missing', { status: 404 }) });
  await app.click();
  assert.match(app.nodes.viewerMessage.textContent, /失败/);
  assert.deepEqual(saved, []);
  assert.equal(app.nodes.downloadLink.textContent, '下载');
  await app.click();
  assert.equal(app.requests.length, 2);
});

test('repeated taps during an APK save submit only one copy to the gallery', async () => {
  let finish;
  const saved = [];
  const response = { ok: true, blob: () => new Promise(resolve => { finish = resolve; }) };
  const app = setup({ saver: { save: (...args) => saved.push(args) }, response });
  const first = app.click();
  await Promise.resolve();
  await app.click();
  assert.equal(app.requests.length, 1);
  finish(new Blob(['original-image'], { type: 'image/png' }));
  await first;
  assert.equal(saved.length, 1);
});
