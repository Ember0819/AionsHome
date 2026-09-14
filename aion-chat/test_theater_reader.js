const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, 'static/theater-studio.js'), 'utf8');
function section(start, end) { return source.slice(source.indexOf(start), source.indexOf(end)); }

test('starting a chapter collapses the cleared multiline input, failure keeps the draft',async()=>{
  const input={value:'本章想法\n补充场景\n更多细节',style:{height:'120px'},get scrollHeight(){return this.value?120:42;}};
  const c=vm.createContext({planning:()=>false,chapter:()=>({id:'chapter'}),player:null,
    $:()=>input,request:async()=>({}),refresh:async()=>{}});
  const shell=fs.readFileSync(require('node:path').join(__dirname,'static/theater.html'),'utf8');
  vm.runInContext(shell.slice(shell.indexOf('function autoResize('),shell.indexOf('/* ── 模型切换')),c);
  vm.runInContext(section('  async function write(', '  async function editChapter('),c);
  await c.write();
  assert.equal(input.value,'');assert.equal(input.style.height,'42px');
  input.value='保留这段想法';input.style.height='120px';
  c.request=async()=>{throw Error('网络失败');};
  await assert.rejects(c.write(),/网络失败/);
  assert.equal(input.value,'保留这段想法');assert.equal(input.style.height,'120px');
});

test('continuation requires confirmation and cancellation keeps the input without a request',async()=>{
  const input={value:'只补充最后一幕'};let calls=0,confirmations=0,accepted=false;
  const current={id:'chapter',content:'已有正文',status:'draft'};
  const c=vm.createContext({planning:()=>false,chapter:()=>current,player:null,
    confirm:()=>{confirmations++;return accepted;},$:()=>input,
    request:async()=>{calls++;},autoResize(){},refresh:async()=>{}});
  vm.runInContext(section('  async function write(', '  async function editChapter('),c);
  await c.write();assert.equal(confirmations,1);assert.equal(calls,0);assert.equal(input.value,'只补充最后一幕');
  accepted=true;await c.write();assert.equal(confirmations,2);assert.equal(calls,1);assert.equal(input.value,'');
  current.writing=true;await c.write();assert.equal(calls,1);assert.equal(confirmations,2);
});

test('discussion messages use configured names and current persona with separate alignment',()=>{
  const c=vm.createContext({discussionNames:{user_name:'读者甲',ai_name:'默认角色'},
    personas:[{id:'chosen',name:'角色乙'}],currentPersonaId:'chosen',book:{writer_name:'旧角色'},
    discussion:{status:'idle'},escHtml:s=>String(s).replaceAll('<','&lt;').replaceAll('>','&gt;')});
  vm.runInContext(section('  function discussionMessage(', '  function renderNovel()'),c);
  const user=c.discussionMessage({id:'u',role:'user',content:'<想法>'});
  assert.match(user,/studio-talk user/);assert.match(user,/读者甲/);assert.match(user,/&lt;想法&gt;/);
  assert.match(user,/Studio.talkAction\('edit','u'\)/);assert.match(user,/Studio.talkAction\('delete','u'\)/);
  assert.doesNotMatch(user,/重新生成/);
  const ai=c.discussionMessage({id:'a',role:'assistant',content:'继续聊'});
  assert.match(ai,/studio-talk assistant/);assert.match(ai,/角色乙/);assert.doesNotMatch(ai,/旧角色/);
  assert.match(ai,/Studio.talkAction\('regenerate','a'\)/);assert.match(ai,/Studio.talkAction\('copy','a'\)/);
});

test('discussion actions save edited text, regenerate and reject edits while generating',async()=>{
  const calls=[];let submit;
  const c=vm.createContext({discussion:{messages:[{id:'u',role:'user',content:'原文'},{id:'a',role:'assistant',content:'回复'}],status:'idle'},
    book:{id:'book'},currentConvId:'book',outlineBusy:false,talkBusy:false,chapters:[],escHtml:s=>s,
    document:{querySelectorAll:()=>[]},modeUI(){},refresh:async()=>{},showToast:s=>calls.push(s),
    request:async(...args)=>calls.push(args),modal:(title,html,label,fn)=>{submit=fn;},$:()=>({value:' 修改后 '})});
  vm.runInContext(section('  async function talkAction(', '  async function discussionMode()'),c);
  await c.talkAction('edit','u');await submit();
  assert.equal(calls[0][0],'/books/book/discussion/messages/u');
  assert.equal(calls[0][1],'PUT');assert.equal(calls[0][2].content,'修改后');
  await c.talkAction('regenerate','a');
  assert.equal(calls[1][0],'/books/book/discussion/messages/a/regenerate');
  c.discussion.status='running';await c.talkAction('delete','u');
  assert.match(calls[2],/先等/);assert.equal(calls.length,3);
});

test('illustrations save through the parent App bridge or a browser download',async()=>{
  const calls=[];
  const parent={AionImageSaver:{save:(...args)=>calls.push(args)}};
  const c=vm.createContext({window:{parent,top:{}},location:{href:'https://home.test/theater'},
    fetch:async()=>({ok:true,blob:async()=>({})}),
    FileReader:class{readAsDataURL(){this.result='data:image/png;base64,IMAGE';this.onload();}},
    URL:class extends URL{static createObjectURL(){return 'blob:picture';}static revokeObjectURL(){}},
    document:{body:{append(){}},createElement(){return {click(){calls.push([this.href,this.download]);},remove(){}};}},
    setTimeout(){},showToast(){}});
  vm.runInContext(section('  async function saveIllustration(', '  function button('),c);
  await c.saveIllustration('/uploads/album/story.png');
  assert.deepEqual(calls[0],['IMAGE','story.png']);
  delete parent.AionImageSaver;
  await c.saveIllustration('/uploads/album/story.png');
  assert.deepEqual(calls[1],['blob:picture','story.png']);
  c.fetch=async()=>({ok:false});
  await assert.rejects(c.saveIllustration('/missing.png'),/图片下载失败/);
  assert.equal(calls.length,2);
});

test('reader controls follow the visible chapter even when the book has pending discussion', () => {
  const elements=new Map();
  const c=vm.createContext({book:{mode:'novel',phase:'discussion'},chapters:[{}],planningView:false,
    outlineBusy:false,talkBusy:false,discussion:{status:'idle'},isStreaming:false,
    document:{body:{classList:{toggle(){}}}},novel:()=>true,chapter:()=>({status:'ready'}),
    updateReaderComposer(){},renderDirectory(){},toolbar(){},renderOutlineStatus(){},$:id=>{if(!elements.has(id))elements.set(id,{setAttribute(){}});return elements.get(id);}});
  vm.runInContext(section('  function modeUI()', '  function renderOutlineStatus()'),c);
  c.modeUI();assert.equal(elements.get('sendBtn').textContent,'下一章');
  c.chapter=()=>({status:'planned'});c.modeUI();assert.equal(elements.get('sendBtn').textContent,'开始写');
  c.chapter=()=>({status:'draft'});c.modeUI();assert.equal(elements.get('sendBtn').textContent,'续写本章');
  c.planningView=true;c.modeUI();assert.equal(elements.get('sendBtn').textContent,'➤');
  assert.equal(elements.get('input').placeholder,'聊聊剧情…');
});

test('outline feedback appears immediately, survives rendering, and reports success or failure',async()=>{
  for(const fails of [false,true]) {
    let finish,calls=0;
    const status={hidden:true,dataset:{},innerHTML:''},input={value:''},messages={scrollHeight:1000};
    const pending=new Promise((resolve,reject)=>{finish=fails?()=>reject(Error('模型连接失败')):()=>resolve({book:{id:'book',phase:'writing'},chapters:[],outline_draft:{plans:[]}});});
    const c=vm.createContext({book:{id:'book',premise:'故事'},currentConvId:'book',outlineBusy:false,outlineFeedback:null,outlineDraft:null,
      talkBusy:false,discussion:{status:'idle',messages:[{content:'本次脑洞'}]},chapters:[],planningView:true,outlineEditor(){},
      novel:()=>true,escHtml:s=>s,$:id=>id==='studioOutlineStatus'?status:id==='input'?input:messages,
      request:()=>{calls++;return pending;},showToast(){},renderPlanning(){},
      setPlanningView(value){c.planningView=value;},modeUI(){c.renderOutlineStatus();}});
    vm.runInContext(section('  function renderOutlineStatus()', '  function renderDirectory()')+
                    section('  async function outline(', '  async function confirmOutline()'),c);
    const task=c.outline();
    assert.equal(status.hidden,false);assert.equal(status.dataset.state,'running');assert.match(status.innerHTML,/正在生成大纲/);
    await c.outline();assert.equal(calls,1);
    c.renderOutlineStatus();assert.equal(status.dataset.state,'running');
    c.currentConvId='another';c.renderOutlineStatus();assert.equal(status.hidden,true);
    c.currentConvId='book';c.renderOutlineStatus();assert.equal(status.hidden,false);
    finish();
    if(fails)await assert.rejects(task,/模型连接失败/);else await task;
    assert.equal(c.outlineBusy,false);assert.equal(status.dataset.state,fails?'error':'done');
    assert.match(status.innerHTML,fails?/模型连接失败/:/大纲已拟好/);
    c.planningView=false;c.renderOutlineStatus();assert.equal(status.hidden,true);
  }
});

test('next chapter remains navigation while the story has unconfirmed discussion', () => {
  let next=0,talk=0;
  const c=vm.createContext({currentConvId:'story',novel:()=>true,planningView:false,
    chapter:()=>({status:'ready'}),action:fn=>fn(),next(){next++;},discuss(){talk++;},
    write(){throw Error('Next chapter must not trigger writing or outline approval');}});
  vm.runInContext(section('  send=function() {','  async function settings()'),c);
  c.send();assert.equal(next,1);
  c.planningView=true;c.send();assert.equal(talk,1);
});

test('chapter completion controls preserve drafts and allow reopening finished chapters',async()=>{
  const elements=new Map();let current={id:'chapter',status:'draft',content:'故事正文',writing:false};
  const calls=[];
  const c=vm.createContext({book:{id:'story'},currentConvId:'story',planningView:false,outlineBusy:false,
    chapter:()=>current,novel:()=>true,request:async(...args)=>calls.push(args),refresh:async()=>calls.push('refresh'),
    $:id=>{if(!elements.has(id))elements.set(id,{});return elements.get(id);},
    button:(label,handler)=>`<button onclick="${handler}">${label}</button>`});
  vm.runInContext(section('  function toolbar()', '  function renderPlanning()'),c);
  vm.runInContext(section('  async function completeChapter(', '  async function editChapter('),c);
  c.toolbar();assert.match(elements.get('studioToolbar').innerHTML,/本章已写完/);
  await c.completeChapter(true);
  assert.equal(calls[0][0],'/chapters/chapter/completion');assert.equal(calls[0][2].completed,true);
  current={...current,status:'ready'};c.toolbar();
  assert.match(elements.get('studioToolbar').innerHTML,/本章还没写完/);
  current.writing=true;c.toolbar();
  assert.doesNotMatch(elements.get('studioToolbar').innerHTML,/本章还没写完|本章已写完/);
  await c.completeChapter(false);assert.equal(calls.length,2);
});

test('deleting a playing message or novel stops the shared player without affecting other stories',()=>{
  const calls=[];
  const c=vm.createContext({player:{source:'message',cid:'story'},
    stopPlayer(){calls.push('stop');c.player=null;},oldDiscardMessageTTS:(...args)=>calls.push(args),
    oldDiscardConversationTTS:id=>calls.push(id)});
  vm.runInContext(section('  discardMessageTTS = function(', '  handleSync = function('),c);
  c.discardMessageTTS('other',true);assert.equal(c.player.source,'message');
  c.discardMessageTTS('message',true);assert.equal(c.player,null);
  c.player={source:'chapter',cid:'novel'};
  c.discardConversationTTS('other-story');assert.equal(c.player.source,'chapter');
  c.discardConversationTTS('novel');assert.equal(c.player,null);
  assert.equal(calls.filter(x=>x==='stop').length,2);
});

test('dialogue replay checks existing recordings without requiring a selected voice',async()=>{
  const calls=[];
  const c=vm.createContext({ttsVoice:'',novel:()=>false,player:null,chapters:[],conversations:[],currentConvId:'story',
    request:async(...args)=>{calls.push(args);return {id:'legacy_msg',status:'ready',segments:[{seq:0,url:'/existing.mp3'}]};},
    stopPlayer(){},localStorage:{getItem:()=>null},$:()=>({classList:{add(){}}}),
    document:{querySelector:()=>({classList:{add(){}}})},pollAudio:async()=>calls.push('play'),showToast:s=>calls.push(s)});
  vm.runInContext(section('  async function speak(', '  replayTTS='),c);
  await c.speak('tm_old');
  assert.equal(calls[0][0],'/speech/tm_old');assert.equal(calls[0][2].prefer_cached,true);
  assert.equal(calls[1],'play');assert.equal(c.player.id,'legacy_msg');
});

test('copy outline sends the chosen model and opens the new story',async()=>{
  const elements={copyStoryTitle:{value:'另一种写法'},copyStoryModel:{},modelSelect:{value:'old-model',innerHTML:'<option>old-model</option><option>new-model</option>'}};
  const calls=[];let submit;
  const c=vm.createContext({book:{id:'source',outline:'大纲'},chapters:[{}],conversations:[{id:'source',title:'原书',model:'old-model'}],
    modes:new Map(),escHtml:s=>s,$:id=>elements[id],modal:(title,html,label,fn)=>{submit=fn;},
    request:async(...args)=>{calls.push(args);return {id:'copy'};},selectConv:async id=>calls.push(id),showToast(){}});
  vm.runInContext(section('  function copyOutline()', '  async function settings()'),c);
  c.copyOutline();assert.equal(elements.copyStoryModel.value,'old-model');
  elements.copyStoryModel.value='new-model';await submit();
  assert.equal(calls[0][0],'/books/source/copy-outline');assert.equal(calls[0][2].model,'new-model');
  assert.equal(calls[0][2].title,'另一种写法');assert.equal(calls[1],'copy');
  assert.equal(c.conversations[0].id,'copy');assert.equal(c.modes.get('copy'),'novel');
});

test('opening discussion leaves the confirmed story phase unchanged and remembers the view', async () => {
  const saved = new Map();
  const c = vm.createContext({book:{id:'story',phase:'writing'},currentConvId:'story',outlineBusy:false,
    player:null,planningView:false,localStorage:{setItem:(k,v)=>saved.set(k,v)},
    modeUI(){},renderPlanning(){},$(){return {focus(){}};},
    request(){throw Error('Navigation must not mutate the story');}});
  vm.runInContext(section('  function setPlanningView(', '  function readerSize(') +
    section('  async function discussionMode()', '  async function outline('), c);
  await c.discussionMode();
  assert.equal(c.planningView,true);
  assert.equal(c.book.phase,'writing');
  assert.equal(saved.get('studio_view_story'),'discussion');
});

test('returning to a chapter during discussion restores reader, position and controls', () => {
  const saved = new Map([['studio_read_one','420']]);
  let updates=0,closed=0;
  const messages={scrollTop:0};
  const c=vm.createContext({currentConvId:'story',planningView:true,selected:null,chapters:[{id:'one'}],
    localStorage:{setItem:(k,v)=>saved.set(k,v),getItem:k=>saved.get(k)},
    modeUI(){updates++;},renderNovel(){},$:id=>id==='messages'?messages:{close(){closed++;}}});
  vm.runInContext(section('  function setPlanningView(', '  function readerSize(')+
    section('  function selectChapter(', '  function next()'),c);
  c.selectChapter('one');
  assert.equal(c.planningView,false);
  assert.equal(saved.get('studio_view_story'),'reader');
  assert.equal(saved.get('studio_chapter_story'),'one');
  assert.equal(messages.scrollTop,420);
  assert.equal(updates,1);
  assert.equal(closed,1);
});

test('font preference applies immediately and persists within the supported range', () => {
  const saved=new Map();let applied;
  const c=vm.createContext({document:{body:{style:{setProperty:(k,v)=>applied=v}}},
    localStorage:{setItem:(k,v)=>saved.set(k,v)},$(){return null;}});
  vm.runInContext(section('  function readerSize(', '  function readingSettings('),c);
  c.readerSize(null);assert.equal(applied,'16px');
  c.readerSize(14);assert.equal(applied,'14px');assert.equal(saved.get('studio_reader_size'),'14');
  c.readerSize(99);assert.equal(applied,'24px');
});
