const assert = require('node:assert/strict');
const path = require('node:path');

const modulePath = path.join(__dirname, 'static', 'toy-svakom.js');
let api = null;
try { api = require(modulePath); } catch (error) {}
assert.ok(api?.createSvakomController, 'missing createSvakomController');
assert.equal(api.withDuration('STRETCH:1', 10), 'STRETCH:1|10');
assert.equal(api.withDuration('VIBRATE:2', 60), 'VIBRATE:2|60');
assert.equal(api.withDuration('HEAT:ON', 30), 'HEAT:ON|30');
assert.equal(api.withDuration('STRETCH:OFF', 10), 'STRETCH:OFF');
assert.equal(api.withDuration('STOP', 10), 'STOP');
assert.equal(api.withDuration('STRETCH:1', 0), 'STRETCH:1');

function fakeTransport() {
  return {
    writes: [],
    connected: false,
    failNext: false,
    async connect() {
      this.connected = true;
      return { deviceName: 'SL278H', protocolConfirmed: true, kind: 'test' };
    },
    async disconnect() { this.connected = false; },
    isConnected() { return this.connected; },
    async sendHex(hex) {
      if (this.failNext) { this.failNext = false; throw new Error('write rejected'); }
      this.writes.push(hex);
    },
    describe() { return { deviceName: 'SL278H', protocolConfirmed: true, kind: 'test' }; },
  };
}

function fakeScheduler() {
  let now = 0;
  let nextId = 1;
  const tasks = new Map();
  return {
    now: () => now,
    setTimeout(fn, delay) {
      const id = nextId++;
      tasks.set(id, { at: now + delay, fn });
      return id;
    },
    clearTimeout(id) { tasks.delete(id); },
    async advance(milliseconds) {
      const target = now + milliseconds;
      while (true) {
        const due = [...tasks.entries()]
          .filter(([, task]) => task.at <= target)
          .sort((left, right) => left[1].at - right[1].at || left[0] - right[0])[0];
        if (!due) break;
        tasks.delete(due[0]);
        now = due[1].at;
        await due[1].fn();
      }
      now = target;
    },
    size: () => tasks.size,
  };
}

async function connectedController(scheduler) {
  const transport = fakeTransport();
  const controller = api.createSvakomController({ transport, scheduler, onState() {}, onLog() {} });
  await controller.connect();
  return { transport, controller };
}

async function main() {
  {
    const { controller } = await connectedController(fakeScheduler());
    await controller.executeText('VIBRATE:2:3');
    assert.equal(controller.getState().vibrateLevel, 3);
    await controller.updateVibrationLevel(8);
    assert.equal(controller.getState().vibrateLevel, 8);
    controller.applyNativeAction('VIBRATE:4:6');
    assert.equal(controller.getState().vibrateLevel, 6);
    await controller.executeText('VIBRATE:OFF');
    assert.equal(controller.getState().vibrateLevel, 0);
  }
  {
    const clock = fakeScheduler();
    const { controller, transport } = await connectedController(clock);
    await controller.executeText('LOOP:1,1,2,3,2;1,0,0,0,0');
    await clock.advance(1000);
    assert.equal(controller.getState().stretch, 0);
    await clock.advance(1000);
    assert.equal(controller.getState().stretch, 1);
    assert.equal(controller.getState().flap, 2);
    await controller.stopAll();
    const stopped = transport.writes.length;
    await clock.advance(6000);
    assert.equal(transport.writes.length, stopped);
  }
  {
    const { controller, transport } = await connectedController(fakeScheduler());
    await controller.executeText('VIBRATE:1:2');
    let release;
    transport.sendHex = async hex => {
      transport.writes.push(hex);
      if (hex === '55030000000000') await new Promise(resolve => { release = resolve; });
    };
    const stopping = controller.executeText('VIBRATE:OFF');
    await controller.updateVibrationLevel(8);
    release();
    await stopping;
    assert.deepEqual(transport.writes, ['55030000010200', '55030000000000'], 'slider must not queue a restart behind a pending OFF');
  }
  {
    const values = [];
    const native = api.createNativeTransport({ setSvakomVibrationLevel(level) { values.push(level); return true; } });
    await native.updateVibrationLevel(7);
    assert.deepEqual(values, [7], 'native updates must use the timer-preserving API');
    await assert.rejects(api.createNativeTransport({}).updateVibrationLevel(7), /更新 App/);
  }
  {
    const clock = fakeScheduler();
    const { controller, transport } = await connectedController(clock);
    const listeners = {};
    const slider = { value: '2', addEventListener: (name, fn) => { listeners[name] = fn; } };
    const output = {};
    assert.equal(typeof api.bindVibrationSlider, 'function');
    api.bindVibrationSlider(slider, output, controller, error => { throw error; }, clock);
    await controller.executeText('VIBRATE:1:2');
    slider.value = '3'; listeners.input();
    slider.value = '8'; listeners.input();
    assert.equal(output.textContent, '8 / 10');
    await clock.advance(120);
    assert.deepEqual(transport.writes, ['55030000010200', '55030000010800'], 'drag events should coalesce to latest level');
    slider.value = '9'; listeners.input();
    await controller.stopAll();
    const stopped = transport.writes.length;
    await clock.advance(120);
    assert.equal(transport.writes.length, stopped, 'pending slider update cannot restart STOP');
  }
  {
    const clock = fakeScheduler();
    const { controller, transport } = await connectedController(clock);
    assert.equal(typeof controller.updateVibrationLevel, 'function', 'live vibration level control is required');
    await controller.updateVibrationLevel(8);
    assert.equal(transport.writes.length, 0, 'a stopped channel must not start');
    await controller.executeText('STRETCH:3');
    await controller.executeText('FLAP:2');
    await controller.executeText('VIBRATE:1:2|5');
    await clock.advance(2000);
    await controller.updateVibrationLevel(8);
    assert.equal(transport.writes.at(-1), '55030000010800');
    assert.equal(controller.getState().stretch, 3);
    assert.equal(controller.getState().flap, 2);
    await clock.advance(3000);
    assert.equal(controller.getState().vibrate, 0, 'original deadline must remain');
    assert.equal(transport.writes.at(-1), '55030000000000');
    const stopped = transport.writes.length;
    await controller.updateVibrationLevel(4);
    assert.equal(transport.writes.length, stopped);
    await controller.executeText('VIBRATE:1:2');
    await controller.updateVibrationLevel(6);
    await controller.executeText('HOLD:VIBRATE|1');
    await controller.updateVibrationLevel(9);
    await clock.advance(1000);
    assert.equal(transport.writes.at(-1), '55030000010600', 'HOLD must restore the applied level, not restart during pause');
    await controller.stopAll();
  }
  {
    const fs = require('node:fs');
    const vm = require('node:vm');
    const source = fs.readFileSync(path.join(__dirname, 'static', 'chat.js'), 'utf8');
    const callbacks = source.slice(source.indexOf('// 原生 BLE 回调'), source.indexOf('const TOY_MOTORS'));
    const events = [];
    const child = {
      location: { origin: 'http://home.test', pathname: '/toys/svakom' },
      toyNativeBle: Object.fromEntries(['onConnected', 'onDisconnected', 'onError', 'onLog', 'onNativeAction']
        .map(method => [method, (...args) => events.push([method, ...args])])),
    };
    const context = { window: {}, location: { origin: 'http://home.test' },
      activeSubPageFrame: { contentWindow: child }, persistentSubPageFrames: new Map(), toyConnected: false,
      toyUpdateUI() {}, toyLog() {} };
    vm.runInNewContext(callbacks, context);
    context.window.toyNativeBle.onLog('正在寻找 SL278…');
    context.window.toyNativeBle.onConnected('svakom', 'SL278H');
    assert.deepEqual(events, [['onLog', '正在寻找 SL278…'], ['onConnected', 'svakom', 'SL278H']],
      'native results must reach the embedded toy page, not only the chat shell');
    assert.equal(context.toyConnected, false, 'SVAKOM must not activate the legacy toy UI');
    context.window.toyNativeBle.onNativeAction('FLAP:OFF');
    context.window.toyNativeBle.onError('未找到设备');
    context.window.toyNativeBle.onDisconnected();
    assert.deepEqual(events.slice(2), [['onNativeAction', 'FLAP:OFF'], ['onError', '未找到设备'], ['onDisconnected']]);
    child.location.pathname = '/';
    context.window.toyNativeBle.onConnected();
    assert.equal(context.toyConnected, true, 'legacy chat callbacks remain intact outside the new toy page');
    child.location.pathname = '/toys/svakom';
    child.location.origin = 'https://other.test';
    context.window.toyNativeBle.onLog('private');
    assert.equal(events.length, 5, 'do not forward native data to a different origin');
    child.location.origin = 'http://home.test';
    context.activeSubPageFrame = null;
    context.persistentSubPageFrames.set('/toys/svakom', { contentWindow: child });
    context.window.toyNativeBle.onNativeAction('STRETCH:OFF');
    assert.deepEqual(events.at(-1), ['onNativeAction', 'STRETCH:OFF'], 'hidden toy page still receives native timer completion');
    context.window.AionBle = { getProfile: () => 'sosexy' };
    context.window.toyNativeBle.onConnected('sosexy', 'SOSEXY');
    assert.equal(events.length, 6, 'old toy callbacks must not enter a preserved SVAKOM page');

    const navigation = source.slice(source.indexOf('function subPagePath('), source.indexOf('function syncHealthRingPageVisibility('));
    vm.runInNewContext(navigation, Object.assign(context, { URL }));
    assert.equal(context.isPersistentSubPage('/toys/svakom'), true, 'returning to chat must retain the control page');
    child.location.href = 'http://home.test/toys/svakom';
    assert.equal(context.shouldNavigatePersistentSubPage({ contentWindow: child, dataset: {} }, '/toys/svakom'), false);
  }
  {
    const scheduler = fakeScheduler();
    const { controller } = await connectedController(scheduler);
    await controller.executeText('FLAP:1|5');
    await controller.executeText('STRETCH:2|3');
    await controller.executeText(api.buildTimeline([{ seconds: 10, stretch: 1, flap: 'KEEP' }]).command);
    await scheduler.advance(5000);
    assert.equal(controller.getState().flap, 0, 'KEEP preserves the existing deadline');
    assert.equal(controller.getState().stretch, 1, 'explicit timeline action replaces its old deadline');
    await controller.stopAll();
  }
  {
    const scheduler = fakeScheduler();
    const { controller, transport } = await connectedController(scheduler);
    await controller.executeText('STRETCH:3|10');
    await controller.executeText('VIBRATE:10:2|8');
    await controller.executeText('FLAP:1|5');
    assert.deepEqual(transport.writes, ['55080000030000', '550300000a0200', '55070000010000']);
    await scheduler.advance(5000);
    assert.equal(controller.getState().stretch, 3);
    assert.equal(controller.getState().vibrate, 10);
    assert.equal(controller.getState().flap, 0);
    assert.equal(transport.writes.length, 4, 'no linked loop may overwrite independent channels');
    await scheduler.advance(5000);
    assert.equal(controller.getState().stretch, 0);
    assert.equal(controller.getState().vibrate, 0);
    assert.equal(scheduler.size(), 0);
  }
  {
    const scheduler = fakeScheduler();
    const { controller, transport } = await connectedController(scheduler);
    await controller.executeText('FLAP:7');
    await controller.executeText('HOLD:FLAP|2');
    await controller.stopAll();
    const stopped = transport.writes.length;
    await scheduler.advance(10000);
    assert.equal(transport.writes.length, stopped);
    assert.equal(scheduler.size(), 0);

    await controller.executeText('FLAP:1|2');
    await controller.executeText('HOLD:FLAP|3');
    await scheduler.advance(5000);
    assert.equal(controller.getState().flap, 0, 'duration expiry must prevent a later HOLD restore');

    transport.failNext = true;
    await assert.rejects(controller.executeText('FLAP:1|5'), /write rejected/);
    assert.equal(controller.getState().flap, 0, 'failed write must not claim the new mode');
  }
  const transport = fakeTransport();
  const states = [];
  const controller = api.createSvakomController({
    transport,
    onState: state => states.push(state),
    onLog() {},
  });

  assert.deepEqual(controller.getState(), {
    connected: false,
    connecting: false,
    busy: false,
    deviceName: '',
    protocolConfirmed: false,
    transportKind: '',
    stretch: 0,
    vibrate: 0,
    vibrateLevel: 0,
    flap: 0,
    heat: false,
    lastError: '',
    strengthKnown: false,
  });

  await controller.connect();
  assert.equal(controller.getState().connected, true);
  assert.equal(controller.getState().deviceName, 'SL278H');

  await controller.executeText('STRETCH:3');
  await controller.executeText('VIBRATE:8');
  await controller.executeText('HEAT:ON');
  assert.equal(controller.getState().stretch, 3);
  assert.equal(controller.getState().vibrate, 8);
  assert.equal(controller.getState().heat, true);
  assert.deepEqual(transport.writes.slice(0, 3), [
    '55080000030000',
    '55030000080200',
    '55050137000000',
  ]);

  transport.failNext = true;
  await assert.rejects(controller.executeText('STRETCH:4'), /write rejected/);
  assert.equal(controller.getState().stretch, 3, 'failed write must not claim the new mode');
  assert.match(controller.getState().lastError, /write rejected/);

  await controller.executeText('VIBRATE:OFF');
  assert.equal(controller.getState().vibrate, 0);
  assert.equal(controller.getState().stretch, 3);
  assert.equal(controller.getState().heat, true);

  await controller.stopAll();
  assert.deepEqual(transport.writes.slice(-4), [
    '55080000000000',
    '55030000000000',
    '55070000000000',
    '55050000000000',
  ]);
  assert.equal(controller.getState().stretch, 0);
  assert.equal(controller.getState().vibrate, 0);
  assert.equal(controller.getState().heat, false);

  await controller.disconnect();
  assert.equal(controller.getState().connected, false);
  assert.ok(states.length >= 6);

  {
    const scheduler = fakeScheduler();
    const { controller, transport } = await connectedController(scheduler);
    await controller.executeText('STRETCH:1');
    await scheduler.advance(5000);
    assert.deepEqual(transport.writes, ['55080000010000'], 'factory mode runs without a linked heartbeat');
    await controller.executeText('FLAP:2');
    await controller.executeText('HOLD:ALL|3');
    await controller.executeText('FLAP:OFF');
    await scheduler.advance(3000);
    assert.equal(controller.getState().stretch, 1, 'changing flap does not cancel the body HOLD recovery');
    assert.equal(controller.getState().flap, 0);
    await controller.stopAll();
  }

  {
    const scheduler = fakeScheduler();
    const timed = await connectedController(scheduler);
    await timed.controller.executeText('VIBRATE:2');
    await timed.controller.executeText('STRETCH:3|10');
    await scheduler.advance(9999);
    assert.equal(timed.controller.getState().stretch, 3);
    await scheduler.advance(1);
    assert.equal(timed.controller.getState().stretch, 0);
    assert.equal(timed.controller.getState().vibrate, 2, 'duration stops only its own channel');

    await timed.controller.executeText('STRETCH:1|10');
    await scheduler.advance(5000);
    await timed.controller.executeText('STRETCH:2|10');
    await scheduler.advance(5000);
    assert.equal(timed.controller.getState().stretch, 2, 'replacement cancels the old timer');
    await scheduler.advance(5000);
    assert.equal(timed.controller.getState().stretch, 0);
  }

  {
    const scheduler = fakeScheduler();
    const held = await connectedController(scheduler);
    await held.controller.executeText('STRETCH:3');
    await held.controller.executeText('HOLD:STRETCH|3');
    assert.equal(held.controller.getState().stretch, 0);
    await scheduler.advance(3000);
    assert.equal(held.controller.getState().stretch, 3, 'HOLD restores the previous desired state');

    await held.controller.executeText('STRETCH:2');
    await held.controller.executeText('HOLD:STRETCH|3');
    await held.controller.executeText('STRETCH:OFF');
    await scheduler.advance(3000);
    assert.equal(held.controller.getState().stretch, 0, 'OFF during HOLD prevents recovery');

    await held.controller.executeText('STRETCH:4');
    await held.controller.executeText('HOLD:ALL|3');
    await held.controller.stopAll();
    await scheduler.advance(5000);
    assert.equal(held.controller.getState().stretch, 0, 'STOP during HOLD prevents recovery');
    assert.equal(scheduler.size(), 0);
  }

  {
    const scheduler = fakeScheduler();
    const sequenced = await connectedController(scheduler);
    await sequenced.controller.executeText('SEQ:0=STRETCH:1;5=HOLD:ALL:3;10=STRETCH:2;12=STOP');
    assert.equal(sequenced.controller.getState().stretch, 1);
    await scheduler.advance(5000);
    assert.equal(sequenced.controller.getState().stretch, 0);
    await scheduler.advance(3000);
    assert.equal(sequenced.controller.getState().stretch, 1);
    await scheduler.advance(5000);
    assert.equal(sequenced.controller.getState().stretch, 2, 'HOLD:ALL freezes Timeline time');
    await scheduler.advance(2000);
    assert.equal(sequenced.controller.getState().stretch, 0);

    await sequenced.controller.executeText('SEQ:0=STRETCH:1;5=HOLD:STRETCH:3;7=VIBRATE:2;10=STOP');
    await scheduler.advance(5000);
    assert.equal(sequenced.controller.getState().stretch, 0);
    await scheduler.advance(2000);
    assert.equal(sequenced.controller.getState().vibrate, 2, 'single-channel HOLD does not freeze Timeline');
    await scheduler.advance(1000);
    assert.equal(sequenced.controller.getState().stretch, 1);

    await sequenced.controller.executeText('VIBRATE:5');
    await scheduler.advance(10000);
    assert.equal(sequenced.controller.getState().vibrate, 5, 'manual action cancels the remaining Timeline');
  }

  {
    const scheduler = fakeScheduler();
    const paused = await connectedController(scheduler);
    await paused.controller.executeText('SEQ:0=STRETCH:1;10=VIBRATE:2;20=STOP');
    await scheduler.advance(3000);
    await paused.controller.executeText('HOLD:ALL|5');
    assert.equal(paused.controller.getState().stretch, 0);
    await scheduler.advance(5000);
    assert.equal(paused.controller.getState().stretch, 1);
    await scheduler.advance(6999);
    assert.equal(paused.controller.getState().vibrate, 0);
    await scheduler.advance(1);
    assert.equal(paused.controller.getState().vibrate, 2, 'manual HOLD:ALL shifts the remaining Timeline');
  }

  {
    const scheduler = fakeScheduler();
    const run = await connectedController(scheduler);
    const plan = api.buildTimeline([
      { seconds:2, stretch:3, vibrate:10, level:2, flap:1 },
      { seconds:3, stretch:'KEEP', vibrate:'OFF', flap:4 },
    ]);
    assert.equal(plan.command, 'SEQ:0=STRETCH:3+VIBRATE:10:2+FLAP:1;2=VIBRATE:OFF+FLAP:4;5=STOP');
    await run.controller.executeText(plan.command);
    assert.equal(run.controller.getState().stretch, 3);
    assert.equal(run.controller.getState().vibrate, 10);
    assert.equal(run.controller.getState().flap, 1);
    await scheduler.advance(2000);
    assert.equal(run.controller.getState().stretch, 3, 'KEEP does not send a stop to other channels');
    assert.equal(run.controller.getState().vibrate, 0);
    assert.equal(run.controller.getState().flap, 4);
    await scheduler.advance(3000);
    assert.equal(run.controller.getState().stretch, 0);
    assert.equal(run.controller.getState().flap, 0);
    assert.equal(scheduler.size(), 0);
    assert.throws(() => api.buildTimeline([{ seconds:5 }]), /至少设置一路/);
  }

  {
    const nativeTransport = fakeTransport();
    nativeTransport.commands = [];
    nativeTransport.stopCalls = 0;
    nativeTransport.disconnectCalls = 0;
    nativeTransport.executeText = async command => { nativeTransport.commands.push(command); };
    nativeTransport.stopAll = async () => { nativeTransport.stopCalls += 1; };
    nativeTransport.disconnect = async () => { nativeTransport.disconnectCalls += 1; nativeTransport.connected = false; };
    const nativeController = api.createSvakomController({
      transport: nativeTransport,
      onState() {},
      onLog() {},
    });
    await nativeController.connect();
    assert.equal(nativeController.getState().strengthKnown, false, 'a recovered native connection is not evidence of stopped channels');
    await nativeController.executeText('STRETCH:2|10');
    assert.deepEqual(nativeTransport.commands, ['STRETCH:2|10']);
    assert.deepEqual(nativeTransport.writes, [], 'native scheduling must not fall back to foreground JS timers');
    assert.equal(nativeController.getState().stretch, 0, 'bridge acceptance is not a native action callback');
    nativeController.applyNativeAction('STRETCH:2');
    assert.equal(nativeController.getState().stretch, 2);
    nativeController.applyNativeAction('STRETCH:OFF');
    assert.equal(nativeController.getState().stretch, 0, 'native timer callbacks keep the page state in sync');
    await nativeController.executeText('FLAP:1|5');
    assert.equal(nativeTransport.stopCalls, 0, 'flap no longer performs a global stop');
    assert.equal(nativeTransport.commands.at(-1), 'FLAP:1|5');
    assert.equal(nativeController.getState().flap, 0);
    nativeController.applyNativeAction('FLAP:1');
    assert.equal(nativeController.getState().strengthKnown, false);
    nativeController.applyNativeAction('VIBRATE:2:3');
    assert.equal(nativeController.getState().strengthKnown, true);
    nativeController.applyNativeError('write rejected');
    assert.equal(nativeController.getState().strengthKnown, false);
    assert.equal(nativeController.getState().lastError, 'write rejected');
    nativeController.applyNativeAction('STRETCH:1');
    assert.equal(nativeController.getState().strengthKnown, false, 'body callback does not establish either intensity channel');
    nativeController.applyNativeAction('FLAP:OFF');
    assert.equal(nativeController.getState().flap, 0);
    await nativeController.stopAll();
    assert.equal(nativeTransport.stopCalls, 1);
    assert.equal(nativeController.getState().vibrate, 2, 'STOP submission must also await its callback');
    nativeController.applyNativeAction('STOP');
    assert.equal(nativeController.getState().strengthKnown, true);
    assert.equal(nativeController.getState().vibrateLevel, 0);
    nativeController.handleTransportDisconnected();
    assert.equal(nativeController.getState().connected, false);
    assert.equal(nativeTransport.disconnectCalls, 0, 'a native disconnect callback must not request another disconnect');
  }

  {
    const scheduler = fakeScheduler();
    const transport = fakeTransport();
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const write = transport.sendHex.bind(transport);
    let first = true;
    transport.sendHex = async hex => {
      if (first) { first = false; await gate; }
      await write(hex);
    };
    const controller = api.createSvakomController({ transport, scheduler });
    await controller.connect();
    const pending = controller.executeText('SEQ:0=STRETCH:3+VIBRATE:2:1;10=STOP');
    await controller.stopAll();
    release();
    await pending;
    const count = transport.writes.length;
    await scheduler.advance(15000);
    assert.equal(controller.getState().stretch, 0, 'an in-flight write cannot restore state after STOP');
    assert.equal(transport.writes.length, count);
    assert.ok(!transport.writes.includes('55030000020100'), 'STOP cancels the next action in the same timeline event');
    assert.equal(scheduler.size(), 0);
  }

  {
    let touched = false;
    const oldBridge = api.createNativeTransport({ connect() { touched = true; } });
    await assert.rejects(oldBridge.connect(), /新版 App/);
    assert.equal(touched, false, 'old native firmware bridge must not issue linked commands');
  }

  {
    const scheduler = fakeScheduler();
    let disconnects = 0;
    const native = api.createNativeTransport({
      getSvakomControlVersion: () => 2, selectProfile() {}, connect() {},
      disconnect() { disconnects++; },
    }, { scheduler });
    let outcome = 'pending';
    const attempt = native.connect().catch(error => { outcome = error.message; });
    await scheduler.advance(20000);
    assert.match(outcome, /超时/, 'an unresponsive native connection must not wait forever');
    await attempt;
    assert.equal(disconnects, 1, 'timeout releases the unfinished BLE attempt');
    const retry = native.connect();
    native.onConnected('svakom', 'SL278H');
    assert.equal((await retry).deviceName, 'SL278H');
    await scheduler.advance(20000);
    assert.equal(disconnects, 1, 'successful connection cancels its deadline');
    assert.equal(native.isConnected(), true);
    await native.disconnect();
    let failure = 'pending';
    const interrupted = native.connect().catch(error => { failure = error.message; });
    native.onDisconnected();
    await Promise.resolve();
    assert.match(failure, /断开/, 'native disconnect must settle an in-progress connection');
    await interrupted;
    assert.equal(scheduler.size(), 0);
  }

  {
    const native = api.createNativeTransport({
      getSvakomControlVersion: () => 2, selectProfile() {},
      isConnected: () => true, getProfile: () => 'svakom', getDeviceName: () => 'SL278H',
      connect() { throw new Error('must reuse the verified existing native connection'); },
    });
    assert.equal((await native.connect()).protocolConfirmed, true,
      'page reload can recover a connection whose original callback went to the shell');
  }

  console.log('svakom controller: success state, write failure and stop behavior passed');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
