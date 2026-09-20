(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.SvakomProtocol = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  const MAX_DURATION = 3600;
  const MAX_HOLD = 999;
  const MAX_EVENTS = 64;

  function fail(error) { return { ok: false, error }; }
  function ok(command) { return { ok: true, command }; }

  function unwrap(value) {
    let raw = String(value || '').trim().toUpperCase();
    const bracketed = raw.match(/^\[TOY:([\s\S]+)\]$/);
    if (bracketed) raw = bracketed[1].trim();
    return raw;
  }

  function parseDuration(value, maximum) {
    if (!/^\d+$/.test(value || '')) return 0;
    const seconds = Number(value);
    return seconds >= 1 && seconds <= maximum ? seconds : 0;
  }

  function parseOrdinary(raw, allowDuration) {
    const parts = raw.split('|');
    if (parts.length > (allowDuration ? 2 : 1)) return null;
    const base = parts[0];
    const duration = parts.length === 2 ? parseDuration(parts[1], MAX_DURATION) : 0;
    if (parts.length === 2 && !duration) return null;

    let match = base.match(/^STRETCH:([1-7])$/);
    if (match) return { kind: 'stretch', mode: Number(match[1]), duration, raw };
    if (base === 'STRETCH:OFF' && !duration) return { kind: 'stretch', mode: 0, duration: 0, raw };

    match = base.match(/^VIBRATE:(10|[1-9])(?::(10|[1-9]))?$/);
    if (match) return { kind: 'vibrate', mode: Number(match[1]), duration, raw, ...(match[2] ? { vibrateLevel: Number(match[2]) } : {}) };
    if (base === 'VIBRATE:OFF' && !duration) return { kind: 'vibrate', mode: 0, duration: 0, raw };

    match = base.match(/^FLAP:([1-7])$/);
    if (match) return { kind: 'flap', mode: Number(match[1]), duration, raw };
    if (base === 'FLAP:OFF' && !duration) return { kind: 'flap', mode: 0, duration: 0, raw };

    if (base === 'HEAT:ON') return { kind: 'heat', enabled: true, duration, raw };
    if (base === 'HEAT:OFF' && !duration) return { kind: 'heat', enabled: false, duration: 0, raw };
    return null;
  }

  function parseSequenceAction(raw) {
    const hold = raw.match(/^HOLD:(ALL|STRETCH|VIBRATE|FLAP|HEAT):([1-9]\d{0,2})$/);
    if (hold) {
      const seconds = parseDuration(hold[2], MAX_HOLD);
      return seconds ? { kind: 'hold', scope: hold[1].toLowerCase(), seconds, raw } : null;
    }
    if (raw === 'STOP') return { kind: 'stop', raw };
    return parseOrdinary(raw, false);
  }

  function parseSequence(raw) {
    const spec = raw.slice(4);
    const entries = spec.split(';');
    if (entries.length < 2 || entries.length > MAX_EVENTS) return fail('时间轴事件数量必须为 2～64 个');
    const events = [];
    let previous = -1;
    for (const entry of entries) {
      const separator = entry.indexOf('=');
      if (separator <= 0) return fail('时间轴事件缺少时间或动作');
      const atText = entry.slice(0, separator);
      const actionText = entry.slice(separator + 1);
      if (!/^\d+$/.test(atText)) return fail('时间点必须是整数秒');
      const at = Number(atText);
      if (at > MAX_DURATION) return fail('时间轴最长 3600 秒');
      if (at <= previous) return fail('时间点必须严格递增');
      const actionParts = actionText.split('+');
      const actions = actionParts.map(parseSequenceAction);
      if (actions.some(action => !action)) return fail('时间轴包含无效动作');
      if (actions.some(action => action.kind === 'hold') && actions.length !== 1) return fail('HOLD 必须独占时间点');
      if (actions.some(action => action.kind === 'stop') && actions.length !== 1) return fail('STOP 必须独占时间点');
      events.push({ at, actions });
      previous = at;
    }
    if (events[0].at !== 0) return fail('时间轴必须从 0 秒开始');
    const last = events[events.length - 1];
    if (last.actions.length !== 1 || last.actions[0].kind !== 'stop') return fail('时间轴最后一项必须是 STOP');
    if (events.slice(0, -1).some(event => event.actions.some(action => action.kind === 'stop'))) return fail('STOP 只能出现在最后');
    return ok({ kind: 'sequence', events, raw });
  }

  function parseLoop(raw) {
    const rows = raw.slice(5).split(';');
    if (!rows.length || rows.length > 63) return fail('循环需要 1～63 段');
    const events = [];
    let seconds = 0;
    for (const row of rows) {
      if (!/^\d+,\d+,\d+,\d+,\d+$/.test(row)) return fail('每段格式：秒数,主体模式,震动花样,震动力度,拍打档位');
      const [duration, stretch, vibrate, level, flap] = row.split(',').map(Number);
      if (duration < 1 || seconds + duration > MAX_DURATION || stretch > 7 || vibrate > 10 || flap > 7 ||
          (vibrate === 0 ? level !== 0 : level < 1 || level > 10)) return fail('循环参数超出范围');
      events.push({ at: seconds, actions: [
        parseOrdinary(stretch ? `STRETCH:${stretch}` : 'STRETCH:OFF', false),
        parseOrdinary(vibrate ? `VIBRATE:${vibrate}:${level}` : 'VIBRATE:OFF', false),
        parseOrdinary(flap ? `FLAP:${flap}` : 'FLAP:OFF', false),
      ] });
      seconds += duration;
    }
    return ok({ kind: 'sequence', events, cycleSeconds: seconds, raw });
  }

  function parse(value) {
    const raw = unwrap(value);
    if (!raw) return fail('请输入控制指令');
    if (raw.startsWith('TUNE:')) return fail('联动调速指令已停用，请使用各路原厂模式');
    if (raw === 'STOP') return ok({ kind: 'stop', raw });
    if (raw.startsWith('LOOP:')) return parseLoop(raw);
    if (raw.startsWith('SEQ:')) return parseSequence(raw);
    const hold = raw.match(/^HOLD:(ALL|STRETCH|VIBRATE|FLAP|HEAT)\|([1-9]\d{0,2})$/);
    if (hold) {
      const seconds = parseDuration(hold[2], MAX_HOLD);
      return seconds ? ok({ kind: 'hold', scope: hold[1].toLowerCase(), seconds, raw }) : fail('HOLD 时长必须为 1～999 秒');
    }
    const ordinary = parseOrdinary(raw, true);
    return ordinary ? ok(ordinary) : fail('无法识别这条 SAVKOM 指令');
  }

  function byteHex(value) { return Number(value).toString(16).padStart(2, '0'); }

  function encode(action) {
    if (!action || typeof action !== 'object') throw new TypeError('缺少 SAVKOM 动作');
    if (action.kind === 'stretch') {
      if (!Number.isInteger(action.mode) || action.mode < 0 || action.mode > 7) throw new RangeError('伸缩模式必须为 0～7');
      return `55080000${byteHex(action.mode)}0000`;
    }
    if (action.kind === 'vibrate') {
      if (!Number.isInteger(action.mode) || action.mode < 0 || action.mode > 10) throw new RangeError('震动模式必须为 0～10');
      const level = action.vibrateLevel ?? 2;
      if (!Number.isInteger(level) || level < 1 || level > 10) throw new RangeError('震动力度必须为 1～10');
      const intensity = action.mode === 0 ? 0 : level;
      return `55030000${byteHex(action.mode)}${byteHex(intensity)}00`;
    }
    // SL278H-F, factory AutoModeController v20: [55, 07, 00, 00, mode, 00, 00].
    // The seven settings encode in the mode byte; there is no separate strength slider.
    if (action.kind === 'flap') {
      if (!Number.isInteger(action.mode) || action.mode < 0 || action.mode > 7) throw new RangeError('拍打档位必须为 0～7');
      return `55070000${byteHex(action.mode)}0000`;
    }
    if (action.kind === 'heat') return action.enabled ? '55050137000000' : '55050000000000';
    throw new TypeError('该动作不能直接编码为单个数据包');
  }

  function validateSequence(spec) {
    const result = parse(String(spec || '').startsWith('SEQ:') ? spec : `SEQ:${spec}`);
    return result.ok && result.command.kind === 'sequence' ? result : fail(result.error || '无效时间轴');
  }

  return Object.freeze({
    MAX_DURATION,
    MAX_HOLD,
    MAX_EVENTS,
    parse,
    encode,
    validateSequence,
  });
});
