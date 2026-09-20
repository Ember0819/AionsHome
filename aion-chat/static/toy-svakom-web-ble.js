(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) Object.assign(root, api);
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  const SERVICE_UUID = 0xffe0;
  const WRITE_UUID = 0xffe1;
  const NOTIFY_UUID = 0xffe2;

  function hexToBytes(hex) {
    const value = String(hex || '').trim();
    if (!/^(?:[0-9a-f]{2})+$/i.test(value)) throw new Error('写入数据不是有效十六进制');
    const bytes = new Uint8Array(value.length / 2);
    for (let index = 0; index < value.length; index += 2) {
      bytes[index / 2] = Number.parseInt(value.slice(index, index + 2), 16);
    }
    return bytes;
  }

  function createSvakomWebBle(options) {
    const bluetooth = options?.bluetooth;
    const onStatus = typeof options?.onStatus === 'function' ? options.onStatus : function () {};
    const onLog = typeof options?.onLog === 'function' ? options.onLog : function () {};
    let device = null;
    let server = null;
    let writeCharacteristic = null;
    let connectionGeneration = 0;
    let writeQueue = Promise.resolve();
    let info = {
      kind: 'Chrome Web Bluetooth',
      deviceName: '',
      protocolConfirmed: false,
      serviceFound: false,
      writeFound: false,
      notifyAvailable: false,
      error: '',
    };

    function snapshot() { return { ...info }; }
    function publish(patch) {
      info = { ...info, ...patch };
      onStatus(snapshot());
      return snapshot();
    }

    function clearConnection(reason) {
      connectionGeneration += 1;
      writeCharacteristic = null;
      server = null;
      publish({
        protocolConfirmed: false,
        serviceFound: false,
        writeFound: false,
        notifyAvailable: false,
        error: reason || '',
      });
    }

    async function connect() {
      if (!bluetooth?.requestDevice) throw new Error('当前浏览器不支持 Web Bluetooth，请使用电脑 Chrome 或 Android 小家 App');
      publish({ error: '' });
      device = await bluetooth.requestDevice({
        filters: [{ namePrefix: 'SL278' }],
        optionalServices: [SERVICE_UUID],
      });
      const deviceName = device?.name || '未命名设备';
      publish({ deviceName });
      device.addEventListener?.('gattserverdisconnected', () => {
        clearConnection('蓝牙连接已断开');
        options?.onDisconnected?.();
        onLog('蓝牙连接已断开', 'error');
      });
      server = await device.gatt.connect();

      if (!/^SL278H(?:\b|[-_])/i.test(deviceName)) {
        return publish({ error: `设备名称不匹配：${deviceName}` });
      }

      let service;
      try {
        service = await server.getPrimaryService(SERVICE_UUID);
        publish({ serviceFound: true });
      } catch (error) {
        return publish({ error: `service missing: ${error?.message || error}` });
      }

      try {
        writeCharacteristic = await service.getCharacteristic(WRITE_UUID);
        publish({ writeFound: true });
      } catch (error) {
        writeCharacteristic = null;
        return publish({ error: `write characteristic missing: ${error?.message || error}` });
      }

      try {
        const notify = await service.getCharacteristic(NOTIFY_UUID);
        await notify.startNotifications();
        publish({ notifyAvailable: true });
      } catch (error) {
        publish({ notifyAvailable: false });
        onLog('通知特征不可用，将继续使用写入控制', 'system');
      }

      return publish({ protocolConfirmed: true, error: '' });
    }

    function isConnected() {
      return Boolean(device?.gatt?.connected && server?.connected !== false);
    }

    async function sendHex(hex) {
      if (!isConnected()) throw new Error('蓝牙未连接');
      if (!info.protocolConfirmed || !writeCharacteristic) throw new Error('设备协议尚未确认，已阻止发送');
      const bytes = hexToBytes(hex);
      const target = writeCharacteristic;
      const generation = connectionGeneration;
      const pending = writeQueue.then(async () => {
        if (generation !== connectionGeneration || target !== writeCharacteristic || !isConnected()) throw new Error('蓝牙未连接，已取消待发送动作');
        const properties = target.properties;
        if (properties?.writeWithoutResponse && typeof target.writeValueWithoutResponse === 'function') {
          await target.writeValueWithoutResponse(bytes);
        } else if (properties?.write && typeof target.writeValueWithResponse === 'function') {
          await target.writeValueWithResponse(bytes);
        } else if ((properties?.writeWithoutResponse || properties?.write) && typeof target.writeValue === 'function') {
          await target.writeValue(bytes);
        } else {
          throw new Error('FFE1 未声明可用的蓝牙写入权限');
        }
      });
      writeQueue = pending.catch(() => {});
      await pending;
    }

    async function disconnect() {
      try {
        if (device?.gatt?.connected) device.gatt.disconnect();
        else if (server?.connected && typeof server.disconnect === 'function') server.disconnect();
      } finally {
        device = null;
        clearConnection('');
        info.deviceName = '';
      }
    }

    return Object.freeze({ connect, disconnect, isConnected, sendHex, describe: snapshot, diagnostics: snapshot });
  }

  return Object.freeze({ createSvakomWebBle, hexToBytes, SERVICE_UUID, WRITE_UUID, NOTIFY_UUID });
});
