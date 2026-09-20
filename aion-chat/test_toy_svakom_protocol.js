const assert = require('node:assert/strict');
const path = require('node:path');

const modulePath = path.join(__dirname, 'static', 'toy-svakom-protocol.js');
let protocol = null;
try { protocol = require(modulePath); } catch (error) {}

assert.ok(protocol, 'missing SvakomProtocol module');
const loop = protocol.parse('LOOP:3,1,0,0,2;5,0,2,4,0;2,0,0,0,0');
assert.equal(loop.ok, true);
assert.equal(loop.command.cycleSeconds, 10);
assert.deepEqual(loop.command.events.map(e => e.at), [0, 3, 8]);
for (const bad of ['LOOP:0,1,0,0,1', 'LOOP:3,1,0,2,1', 'LOOP:3,1,1,0,1', 'LOOP:3,8,0,0,1', 'LOOP:3600,1,0,0,0;1,0,0,0,0']) assert.equal(protocol.parse(bad).ok, false, bad);
for (let mode = 1; mode <= 7; mode++) {
  const parsed = protocol.parse(`FLAP:${mode}|5`);
  assert.equal(parsed.ok, true, 'independent flap is a separate channel');
  assert.equal(parsed.command.duration, 5);
  assert.equal(protocol.encode(parsed.command), `550700000${mode}0000`);
}
assert.equal(protocol.encode(protocol.parse('FLAP:OFF').command), '55070000000000');
for (const invalid of ['FLAP:0', 'FLAP:8', 'FLAP:OFF|5', 'FLAP:1|3601', 'FLAP:2:40']) {
  assert.equal(protocol.parse(invalid).ok, false);
}

assert.equal(protocol.encode({ kind: 'stretch', mode: 1 }), '55080000010000');
assert.equal(protocol.encode({ kind: 'stretch', mode: 7 }), '55080000070000');
assert.equal(protocol.encode({ kind: 'stretch', mode: 0 }), '55080000000000');
assert.equal(protocol.encode({ kind: 'vibrate', mode: 8 }), '55030000080200');
assert.equal(protocol.encode({ kind: 'vibrate', mode: 0 }), '55030000000000');
assert.equal(protocol.encode({ kind: 'heat', enabled: true }), '55050137000000');
assert.equal(protocol.encode({ kind: 'heat', enabled: false }), '55050000000000');

assert.deepEqual(protocol.parse('[TOY:STRETCH:3|30]'), {
  ok: true,
  command: { kind: 'stretch', mode: 3, duration: 30, raw: 'STRETCH:3|30' },
});
assert.deepEqual(protocol.parse('VIBRATE:8'), {
  ok: true,
  command: { kind: 'vibrate', mode: 8, duration: 0, raw: 'VIBRATE:8' },
});
assert.deepEqual(protocol.parse('[TOY:HEAT:ON]'), {
  ok: true,
  command: { kind: 'heat', enabled: true, duration: 0, raw: 'HEAT:ON' },
});
assert.equal(protocol.parse('STRETCH:8').ok, false);
assert.equal(protocol.encode(protocol.parse('VIBRATE:9').command), '55030000090200');
assert.equal(protocol.encode(protocol.parse('VIBRATE:10:10').command), '550300000a0a00');
assert.equal(protocol.parse('VIBRATE:11').ok, false);
assert.equal(protocol.parse('STRETCH:1|0').ok, false);
assert.equal(protocol.parse('HEAT:ON|3601').ok, false);
assert.equal(protocol.parse('HOLD:ALL|0').ok, false);
assert.deepEqual(protocol.parse('STOP'), { ok: true, command: { kind: 'stop', raw: 'STOP' } });

const validSequence = protocol.parse('[TOY:SEQ:0=STRETCH:1;5=VIBRATE:2;8=STOP]');
assert.equal(validSequence.ok, true);
assert.equal(validSequence.command.kind, 'sequence');
assert.equal(validSequence.command.events.length, 3);
assert.equal(protocol.parse('SEQ:1=STRETCH:1;8=STOP').ok, false);
assert.equal(protocol.parse('SEQ:0=STRETCH:1;5=VIBRATE:2;5=STOP').ok, false);
assert.equal(protocol.parse('SEQ:0=HOLD:ALL:3+VIBRATE:1;8=STOP').ok, false);
assert.equal(protocol.parse('SEQ:0=STRETCH:1;8=VIBRATE:OFF').ok, false);

console.log('svakom protocol: encoding and validation passed');

assert.equal(protocol.parse('TUNE:200:40:2').ok, false);
assert.equal(protocol.parse('TUNE:201:40:2').ok, false);
assert.equal(protocol.parse('STRETCH:3:100:101').ok, false);
assert.equal(protocol.parse('VIBRATE:2:11').ok, false);
assert.equal(protocol.parse('STRETCH:3:100:40').ok, false, 'retired linked parameters must not silently run a different mode');
assert.equal(protocol.encode(protocol.parse('VIBRATE:2:1').command), '55030000020100');
