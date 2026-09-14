'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const PatUI = require('./static/pat.js');
const ROOT = __dirname;

function patMessage() {
  return {
    id: 'pat-inline', sender: 'system', role: 'system', content: '「Connor」捏住了「Ithil」的脸',
    attachments: [
      {type: 'pat', actor: 'connor', target: 'user'},
      {type: 'system_notice_order', after_msg_id: 'reply-inline', inline_offset: 8,
       inline_before: '至于始作俑者——', inline_after: '[心里嘀咕：她还笑得这么开心。]'},
    ],
  };
}

test('inline pat is attached to its source reply and split at the original position', () => {
  const pat = patMessage();
  const reply = {id: 'reply-inline', sender: 'connor', content: '至于始作俑者——[心里嘀咕：她还笑得这么开心。]'};
  const collected = PatUI.collectInlineNotices([pat, reply]);

  assert.equal(collected.noticeIds.has('pat-inline'), true);
  const parts = PatUI.interleaveContent(reply.content, collected.bySourceId.get(reply.id));
  assert.deepEqual(parts.map(part => part.type), ['text', 'notice', 'text']);
  assert.equal(parts[0].text, '至于始作俑者——');
  assert.equal(parts[1].message.id, 'pat-inline');
  assert.equal(parts[2].text, '[心里嘀咕：她还笑得这么开心。]');
});

test('private and chatroom renderers wire inline pats into the message text flow', () => {
  const privateSource = fs.readFileSync(path.join(ROOT, 'static', 'chat.js'), 'utf8');
  const chatroomSource = fs.readFileSync(path.join(ROOT, 'static', 'chatroom.js'), 'utf8');

  for (const source of [privateSource, chatroomSource]) {
    assert.match(source, /collectInlineNotices/);
    assert.match(source, /_inlinePatNotices/);
    assert.match(source, /interleaveContent/);
  }
  assert.match(privateSource, /privateSystemMessageHTML\(item\.message\)/);
  assert.match(chatroomSource, /msgHTML\(item\.message\)/);
});
