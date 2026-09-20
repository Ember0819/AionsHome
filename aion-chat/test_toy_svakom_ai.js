const assert = require('node:assert/strict');
const { createSvakomAiControl, createSvakomStateReporter } = require('./static/toy-svakom-ai.js');

async function main() {
  const reports = [];
  const reporter = createSvakomStateReporter({ source: 'phone', request: async (url, options) => {
    assert.equal(url, '/api/svakom-ai/state');
    reports.push(JSON.parse(options.body));
    return { ok: true };
  }});
  const hardware = { connected: true, protocolConfirmed: true, strengthKnown: true, busy: false, lastError: '', stretch: 7, flap: 4, vibrate: 2, vibrateLevel: 3 };
  await reporter.report({ ...hardware, connected: false }, true);
  await reporter.report(hardware, false);
  assert.equal(reports.length, 0, 'idle pages and disabled capability must not report');
  await reporter.report(hardware, true);
  await reporter.report({ ...hardware, vibrateLevel: 8 }, true);
  await reporter.report({ ...hardware, connected: false }, true);
  assert.equal(reports[0].vibrate_level, 3);
  assert.equal(reports[1].vibrate_level, 8);
  assert.equal(reports[2].connected, false);
  assert.ok(reports[2].sequence > reports[1].sequence);
  assert.equal(reports[0].stretch, undefined, 'body rhythm does not enter the intensity report');
  await reporter.report({ ...hardware, strengthKnown: false }, true);
  assert.equal(reports.at(-1).connected, false, 'unconfirmed native channel values must not become a numeric intensity');
  let permission = { enabled: true, epoch: 'one' };
  let connected = true;
  const actions = [];
  const controller = {
    getState: () => ({ connected, protocolConfirmed: connected }),
    executeText: async raw => { actions.push(raw); },
    stopAll: async () => { actions.push('STOP'); },
  };
  const request = async (url, options) => {
    if (url.endsWith('/takeover')) permission = { ...permission, epoch: 'two' };
    if (options?.method === 'PUT') permission = { enabled: JSON.parse(options.body).enabled, epoch: 'three' };
    return { ok: true, json: async () => ({ ...permission }) };
  };
  const ai = createSvakomAiControl({ controller, request });
  await ai.refresh();
  const event = { type: 'svakom_command', data: { epoch: 'one', event_id: '1', command: 'LOOP:1,1,0,0,2' } };
  await ai.receive(event);
  await ai.receive(event);
  assert.deepEqual(actions, ['LOOP:1,1,0,0,2']);
  permission = { enabled: false, epoch: 'off' };
  await ai.receive({ type: 'capability_config_changed', data: { key: 'svakom' } });
  assert.deepEqual(actions, ['LOOP:1,1,0,0,2', 'STOP']);
  permission = { enabled: true, epoch: 'one' };
  await ai.refresh();
  connected = false;
  await ai.receive({ ...event, data: { ...event.data, event_id: 'offline' } });
  connected = true;
  await ai.receive({ ...event, data: { ...event.data, event_id: 'offline' } });
  assert.equal(actions.length, 2, 'offline commands must not replay');
  await ai.takeover();
  await ai.receive({ ...event, data: { ...event.data, event_id: 'late' } });
  assert.equal(actions.length, 2, 'previous permission cannot regain control');
  const pending = [];
  const racing = createSvakomAiControl({ controller, request: () => new Promise(resolve => pending.push(resolve)) });
  const older = racing.receive(event);
  const stop = racing.receive({ ...event, data: { ...event.data, event_id: 'stop', command: 'STOP' } });
  const response = { ok: true, json: async () => ({ enabled: true, epoch: 'one' }) };
  pending[1](response);
  await stop;
  pending[0](response);
  await older;
  assert.deepEqual(actions.slice(2), ['STOP'], 'late permission fetch must not restart an older plan after STOP');
  permission = { enabled: true, epoch: 'one' };
  const manual = createSvakomAiControl({ controller, request });
  await manual.receive({ ...event, data: { ...event.data, event_id: 'manual' } });
  await manual.takeover();
  assert.equal(actions.at(-1), 'STOP', 'manual takeover must stop the running loop even if the following manual input is invalid');
  console.log('svakom AI: independent delivery, dedupe, offline drop, revoke and toggle passed');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
