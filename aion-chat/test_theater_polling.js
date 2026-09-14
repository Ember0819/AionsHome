const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname,'static/theater-studio.js'),'utf8');
function fixture() {
  let now=0, books=0, audio=0;
  const c=vm.createContext({performance:{now:()=>now},document:{hidden:false},subPageVisible:true,
    outlineBusy:false,talkBusy:false,discussion:{status:'idle'},chapters:[],player:null,
    lastBookPoll:0,lastAudioPoll:0,
    refresh(){books++;c.lastBookPoll=now;},pollAudio(){audio++;c.lastAudioPoll=now;}});
  vm.runInContext(source.slice(source.indexOf('  function backgroundPoll()'),source.indexOf('  async function refresh()')),c);
  return {c,tick(t){now=t;c.backgroundPoll();return {books,audio};}};
}
test('idle book never polls, active generation refreshes promptly and stops when finished',()=>{
  const f=fixture();for(let i=1;i<=3600;i++)assert.equal(f.tick(i*1000).books,0);
  f.c.discussion.status='running';assert.equal(f.tick(3601000).books,1);
  f.c.discussion.status='idle';f.c.chapters=[{processing:true}];assert.equal(f.tick(3602000).books,2);
  f.c.chapters=[];assert.equal(f.tick(7200000).books,2);
});
test('repair polls only pending work while visible',()=>{
  const s=fs.readFileSync(require('node:path').join(__dirname,'static/repair.js'),'utf8');
  let polls=0;const c=vm.createContext({window:{},document:{hidden:false},state:{},renderActivity(){},poll(){polls++;}});
  vm.runInContext(s.slice(s.indexOf('  let subPageVisible'),s.indexOf('  async function poll()')),c);
  c.backgroundPoll();assert.equal(polls,0);c.state.active={state:'queued'};c.backgroundPoll();assert.equal(polls,1);
  vm.runInContext('subPageVisible=false',c);c.backgroundPoll();assert.equal(polls,1);
  vm.runInContext('subPageVisible=true',c);c.state.active=null;c.state.pendingSince=1;c.backgroundPoll();assert.equal(polls,2);
  c.state.pendingSince=0;c.backgroundPoll();assert.equal(polls,2);
});
test('theater repeated failed connections keep one reconnect timer',()=>{
  const s=fs.readFileSync(require('node:path').join(__dirname,'static/theater.html'),'utf8');
  const timers=new Map();let id=0;
  class WS{constructor(){this.readyState=3;}send(){}}
  const c=vm.createContext({location:{protocol:'http:',host:'test'},WebSocket:WS,
    setTimeout(fn){timers.set(++id,fn);return id;},clearTimeout(id){timers.delete(id);},sendTTSState(){},theaterClientId:'test'});
  vm.runInContext(s.slice(s.indexOf('let _ws = null;'),s.indexOf('function handleSync')),c);
  for(let i=0;i<20;i++){vm.runInContext('connectWS();_ws.onclose();',c);assert.equal(timers.size,1);}
  vm.runInContext('_ws.onopen()',c);assert.equal(timers.size,0);
});
test('leaving an embedded theater stops book queries even when the document is visible',()=>{
  const f=fixture();f.c.subPageVisible=false;f.c.chapters=[{writing:true}];
  assert.equal(f.tick(60000).books,0);f.c.subPageVisible=true;f.c.document.hidden=true;
  assert.equal(f.tick(90000).books,0);
});
test('background listening fetches new segments, finished or paused hidden audio does not poll',()=>{
  const f=fixture();f.c.subPageVisible=false;f.c.player={status:'running',paused:false};
  assert.deepEqual(f.tick(1000),{books:0,audio:1});f.c.player.paused=true;
  assert.equal(f.tick(2000).audio,1);f.c.player.paused=false;f.c.player.status='ready';
  assert.equal(f.tick(3000).audio,1);
});
