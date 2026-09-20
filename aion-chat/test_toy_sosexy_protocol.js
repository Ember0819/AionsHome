const assert = require('node:assert/strict');
const path = require('node:path');

const modulePath = path.join(__dirname, 'static', 'toy-sosexy-protocol.js');
let protocol = null;
try { protocol = require(modulePath); } catch (error) {}
assert.ok(protocol, 'missing SosexyProtocol module');

assert.equal(protocol.buildDualCmd('0002', 4, '0001', 75), '02000211040001114b');
assert.equal(protocol.buildStopCmd(), '03000111000003110000071100');

const packets = protocol.frameCommand('00112233445566778899aabbccddeeff00', 0x2a);
assert.equal(packets.length, 2, '18-byte payload including prefix needs a terminator');
assert.deepEqual(Array.from(packets[0]), [0x2a, 1, 0x00, 0x00, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88, 0x99, 0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff, 0x00]);
assert.deepEqual(Array.from(packets[1]), [0x2a, 2]);

assert.equal(protocol.DEFAULT_PRESETS.length, 9);
assert.equal(protocol.DEFAULT_PRESETS[0].motors.length, 3);
assert.notEqual(protocol.cloneDefaultPresets(), protocol.DEFAULT_PRESETS);

const saved = JSON.stringify(protocol.DEFAULT_PRESETS);
const storage = { getItem: () => saved, setItem(key, value) { this.saved = { key, value }; } };
const loaded = protocol.loadPresets(storage);
assert.deepEqual(loaded, protocol.DEFAULT_PRESETS);
protocol.savePresets(storage, loaded);
assert.equal(storage.saved.key, 'sosexy_presets_v3');
assert.deepEqual(JSON.parse(storage.saved.value), protocol.DEFAULT_PRESETS);

const invalidStorage = { getItem: () => '[{"motors":[]}]' };
assert.deepEqual(protocol.loadPresets(invalidStorage), protocol.DEFAULT_PRESETS);

console.log('sosexy protocol: legacy encoding, framing and presets passed');
