(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.SosexyProtocol = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  const STORAGE_KEY = 'sosexy_presets_v3';
  const MOTORS = Object.freeze([
    { label: '震动', gearsSpec: '0001', modeSpec: '0002', modes: ['全身酥麻', '渐入佳境', '循序渐进', '欢呼雀跃'] },
    { label: '电流', gearsSpec: '0003', modeSpec: '0004', modes: ['温柔涟漪', '娇舌搅动', '风驰快感', '浪潮不断'] },
    { label: '吮吸', gearsSpec: '0007', modeSpec: '0008', modes: ['连绵不绝', '深海暗涌', '爆裂冲刺', '浪潮不断'] },
  ]);
  const PRESET_NAMES = Object.freeze(['微风轻拂', '春水初生', '暗流涌动', '如梦似幻', '情潮渐涨', '烈焰焚身', '极乐之巅', '魂飞魄散', '失控']);
  const PRESET_ICONS = Object.freeze(['🌸', '💧', '🌊', '✨', '🔥', '💥', '⚡', '💀', '🌀']);
  const DEFAULT_PRESETS = Object.freeze([
    { motors: [{ on: 0, mode: 1, speed: 10 }, { on: 0, mode: 1, speed: 0 }, { on: 1, mode: 1, speed: 10 }] },
    { motors: [{ on: 0, mode: 1, speed: 20 }, { on: 0, mode: 1, speed: 10 }, { on: 1, mode: 3, speed: 20 }] },
    { motors: [{ on: 0, mode: 2, speed: 30 }, { on: 0, mode: 1, speed: 20 }, { on: 1, mode: 2, speed: 30 }] },
    { motors: [{ on: 0, mode: 2, speed: 45 }, { on: 0, mode: 2, speed: 25 }, { on: 1, mode: 4, speed: 40 }] },
    { motors: [{ on: 0, mode: 3, speed: 60 }, { on: 1, mode: 2, speed: 20 }, { on: 1, mode: 2, speed: 50 }] },
    { motors: [{ on: 1, mode: 3, speed: 10 }, { on: 1, mode: 3, speed: 30 }, { on: 1, mode: 4, speed: 60 }] },
    { motors: [{ on: 1, mode: 2, speed: 20 }, { on: 1, mode: 4, speed: 40 }, { on: 1, mode: 4, speed: 80 }] },
    { motors: [{ on: 1, mode: 1, speed: 30 }, { on: 1, mode: 3, speed: 80 }, { on: 1, mode: 3, speed: 100 }] },
    { motors: [{ on: 1, mode: 4, speed: 40 }, { on: 1, mode: 3, speed: 90 }, { on: 1, mode: 3, speed: 100 }] },
  ]);

  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function cloneDefaultPresets() { return clone(DEFAULT_PRESETS); }
  function validMotor(motor) {
    return motor && (motor.on === 0 || motor.on === 1)
      && Number.isInteger(motor.mode) && motor.mode >= 1 && motor.mode <= 4
      && Number.isInteger(motor.speed) && motor.speed >= 0 && motor.speed <= 100;
  }
  function validPresets(value) {
    return Array.isArray(value) && value.length === 9
      && value.every(preset => Array.isArray(preset?.motors) && preset.motors.length === 3 && preset.motors.every(validMotor));
  }
  function loadPresets(storage) {
    try {
      const parsed = JSON.parse(storage?.getItem(STORAGE_KEY) || 'null');
      if (validPresets(parsed)) return clone(parsed);
    } catch (error) {}
    return cloneDefaultPresets();
  }
  function savePresets(storage, presets) {
    if (!validPresets(presets)) throw new Error('预设数据无效');
    storage.setItem(STORAGE_KEY, JSON.stringify(presets));
  }
  function toHex2(value) { return Number(value).toString(16).padStart(2, '0'); }
  function buildDualCmd(spec1, value1, spec2, value2) { return `02${spec1}11${toHex2(value1)}${spec2}11${toHex2(value2)}`; }
  function buildStopCmd() { return '03000111000003110000071100'; }
  function hexToBytes(hex) {
    if (!/^(?:[0-9a-f]{2})+$/i.test(hex)) throw new Error('无效十六进制指令');
    const result = [];
    for (let index = 0; index < hex.length; index += 2) result.push(Number.parseInt(hex.slice(index, index + 2), 16));
    return result;
  }
  function frameCommand(command, randomByte) {
    const data = hexToBytes(`00${command}`);
    const marker = Number.isInteger(randomByte) ? randomByte & 0xff : Math.floor(Math.random() * 255);
    const packets = [];
    for (let start = 0, part = 1; start < data.length; start += 18, part += 1) {
      packets.push(Uint8Array.from([marker, part, ...data.slice(start, start + 18)]));
    }
    if (data.length > 0 && data.length % 18 === 0) packets.push(Uint8Array.from([marker, packets.length + 1]));
    return packets;
  }

  return Object.freeze({ STORAGE_KEY, MOTORS, PRESET_NAMES, PRESET_ICONS, DEFAULT_PRESETS, cloneDefaultPresets, loadPresets, savePresets, buildDualCmd, buildStopCmd, frameCommand });
});
