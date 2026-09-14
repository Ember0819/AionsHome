'use strict';
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const source = fs.readFileSync('static/memory-compression.html', 'utf8');
for (const match of source.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)) new vm.Script(match[1]);
const context = {};
for (const name of ['escapeHistoryText', 'renderHistoryRecord']) {
  vm.runInNewContext(source.match(new RegExp(`    function ${name}[\\s\\S]*?\\n    }`))[0], context);
}
const record = {level:'daily', period_label:'2026-08-29～2026-08-31', completed_at:1,
  input_count:10, output_count:12, durable_output_count:3, memory_output_count:9, model_key:'<model>'};
const grown = context.renderHistoryRecord(record);
assert.match(grown, /输入 <strong>10<\/strong> 条 → 输出 <strong>12<\/strong>/);
assert.match(grown, /history-change grown/);
assert.match(grown, /输出增加 2 条/);
assert.match(grown, /普通记忆 9 条 · 长期事实 3 条/);
assert.match(grown, /&lt;model&gt;/);
const reduced = context.renderHistoryRecord({...record, output_count:5, reduction_percent:50, durable_output_count:null});
assert.match(reduced, /减少 5 条（50%）/);
assert.match(reduced, /旧记录未区分输出类型/);
assert.doesNotMatch(reduced, /history-change grown/);
assert.match(context.renderHistoryRecord({...record, output_count:10}), /条数不变/);
console.log('memory compression history UI passed');
