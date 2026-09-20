const assert = require('node:assert/strict');
const path = require('node:path');

const modulePath = path.join(__dirname, 'static', 'toy-svakom-web-ble.js');
let api = null;
try { api = require(modulePath); } catch (error) {}
assert.ok(api?.createSvakomWebBle, 'missing createSvakomWebBle');

function fixture(options = {}) {
  const writesWithResponse = [];
  const writesWithoutResponse = [];
  const listeners = {};
  const writeCharacteristic = {
    properties: { write: false, writeWithoutResponse: true },
    async writeValueWithResponse(value) { writesWithResponse.push(Array.from(value)); },
    async writeValueWithoutResponse(value) {
      if (options.beforeWrite) await options.beforeWrite();
      writesWithoutResponse.push(Array.from(value));
    },
  };
  const notifyCharacteristic = {
    async startNotifications() { return this; },
  };
  const service = {
    uuid: '0000ffe0-0000-1000-8000-00805f9b34fb',
    async getCharacteristic(uuid) {
      const normalized = String(uuid).toLowerCase();
      if ((uuid === 0xffe1 || normalized.includes('ffe1')) && !options.missingWrite) return writeCharacteristic;
      if ((uuid === 0xffe2 || normalized.includes('ffe2')) && !options.missingNotify) return notifyCharacteristic;
      throw new Error('characteristic missing');
    },
  };
  const server = {
    connected: true,
    async getPrimaryService() {
      if (options.missingService) throw new Error('service missing');
      return service;
    },
    disconnect() { this.connected = false; },
  };
  const device = {
    name: options.name || 'SL278H',
    gatt: { connected: false, async connect() { this.connected = true; return server; }, disconnect() { this.connected = false; server.connected = false; } },
    addEventListener(name, handler) { listeners[name] = handler; },
  };
  let requestOptions = null;
  const bluetooth = {
    async requestDevice(optionsArg) { requestOptions = optionsArg; return device; },
  };
  return { bluetooth, device, server, writesWithResponse, writesWithoutResponse, listeners, requestOptions: () => requestOptions };
}

async function main() {
  {
    const setup = fixture({ name: 'SL278H' });
    const transport = api.createSvakomWebBle({ bluetooth: setup.bluetooth });
    const info = await transport.connect();
    assert.equal(info.deviceName, 'SL278H');
    assert.equal(info.protocolConfirmed, true);
    assert.equal(info.notifyAvailable, true);
    assert.deepEqual(setup.writesWithResponse, [], 'connect must never send an action');
    assert.deepEqual(setup.writesWithoutResponse, [], 'connect must never send an action');
    assert.deepEqual(setup.requestOptions().optionalServices, [0xffe0]);
    assert.ok(setup.requestOptions().filters.some(filter => filter.namePrefix === 'SL278'));
    await transport.sendHex('550400000124aa');
    assert.deepEqual(setup.writesWithResponse, [], 'SL278H must not receive a prohibited write-with-response');
    assert.deepEqual(setup.writesWithoutResponse[0], [0x55, 0x04, 0x00, 0x00, 0x01, 0x24, 0xaa]);
    await transport.disconnect();
    assert.equal(transport.isConnected(), false);
  }

  {
    let release;
    let entered = 0;
    const gate = new Promise(resolve => { release = resolve; });
    const setup = fixture({ beforeWrite: async () => { entered += 1; await gate; } });
    const transport = api.createSvakomWebBle({ bluetooth: setup.bluetooth });
    await transport.connect();
    const first = transport.sendHex('550400000129aa');
    const second = transport.sendHex('550400000147aa');
    const cancelled = assert.rejects(second, /未连接/);
    await Promise.resolve();
    assert.equal(entered, 1, 'rhythm and manual writes must not overlap GATT operations');
    await transport.disconnect();
    release();
    await first;
    await cancelled;
    assert.equal(entered, 1, 'queued work from the disconnected session must never reach the device');
  }

  {
    const setup = fixture({ name: 'SL278K', missingNotify: true });
    const transport = api.createSvakomWebBle({ bluetooth: setup.bluetooth });
    const info = await transport.connect();
    assert.equal(info.deviceName, 'SL278K');
    assert.equal(info.protocolConfirmed, false);
    assert.equal(info.notifyAvailable, false);
    assert.match(info.error, /名称不匹配/);
  }

  for (const missing of ['missingService', 'missingWrite']) {
    const setup = fixture({ [missing]: true });
    const transport = api.createSvakomWebBle({ bluetooth: setup.bluetooth });
    const info = await transport.connect();
    assert.equal(info.protocolConfirmed, false);
    await assert.rejects(transport.sendHex('550400000124aa'), /协议尚未确认/);
    assert.match(transport.diagnostics().error, /missing/);
  }

  {
    const setup = fixture({ name: 'SL999X' });
    const transport = api.createSvakomWebBle({ bluetooth: setup.bluetooth });
    const info = await transport.connect();
    assert.equal(info.protocolConfirmed, false);
    assert.match(info.error, /名称不匹配/);
    assert.deepEqual(setup.writesWithResponse, []);
    assert.deepEqual(setup.writesWithoutResponse, []);
  }

  {
    const setup = fixture();
    const transport = api.createSvakomWebBle({ bluetooth: setup.bluetooth });
    await transport.connect();
    setup.device.name = 'SL999X';
    setup.device.gatt.connected = false;
    setup.server.connected = false;
    setup.listeners.gattserverdisconnected();
    assert.equal(transport.isConnected(), false);
    await assert.rejects(transport.sendHex('550400000124aa'), /未连接/);
  }

  console.log('svakom web bluetooth: discovery, diagnostics and guarded writes passed');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
