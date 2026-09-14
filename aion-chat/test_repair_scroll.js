const test=require('node:test');
const assert=require('node:assert/strict');
const createScroll=require('./static/repair-scroll.js');

function setup(){
  const handlers={},frames=[];
  let top=600,writes=0;
  const el={scrollHeight:1000,clientHeight:400,
    get scrollTop(){return top;},set scrollTop(value){top=Math.min(value,this.scrollHeight-this.clientHeight);writes++;},
    addEventListener(name,fn){handlers[name]=fn;}};
  const jump={hidden:true};const scroll=createScroll(el,jump,fn=>frames.push(fn));
  return {el,jump,scroll,get writes(){return writes;},
    event:(name,data={})=>handlers[name](data),
    move(value){top=value;handlers.scroll();},
    frame(){frames.splice(0).forEach(fn=>fn());}};
}

test('reading even 30px above the bottom survives new output and viewport changes',()=>{
  const s=setup();s.event('wheel',{deltaY:-30});s.move(570);
  s.scroll.changed();s.scroll.layout();s.frame();
  assert.equal(s.el.scrollTop,570);assert.equal(s.writes,0);assert.equal(s.jump.hidden,false);
});

test('a queued resize frame cannot override a later upward touch gesture',()=>{
  const s=setup();s.scroll.layout();
  s.event('touchstart',{touches:[{clientY:100}]});
  s.event('touchmove',{touches:[{clientY:140}]});s.move(560);
  s.event('touchend');s.frame();s.scroll.changed();
  assert.equal(s.el.scrollTop,560);assert.equal(s.writes,0);
});

test('updates do not interrupt a finger on the conversation',()=>{
  const s=setup();s.event('touchstart',{touches:[{clientY:100}]});
  s.el.scrollHeight+=100;s.scroll.changed();
  assert.equal(s.writes,0);assert.equal(s.jump.hidden,false);
});

test('explicit latest and manually reaching bottom resume following',()=>{
  const s=setup();s.event('wheel',{deltaY:-100});s.move(500);
  s.scroll.latest();assert.equal(s.el.scrollTop,600);
  s.el.scrollHeight+=100;s.scroll.changed();assert.equal(s.el.scrollTop,700);
  s.event('wheel',{deltaY:-100});s.move(600);
  s.event('wheel',{deltaY:100});s.move(700);
  s.el.scrollHeight+=100;s.scroll.changed();assert.equal(s.el.scrollTop,800);
  assert.equal(s.jump.hidden,true);
});

test('opening work details pauses following; a new task resets it',()=>{
  const s=setup();s.event('click',{target:{closest:()=>({})}});
  s.el.scrollHeight+=300;s.scroll.changed();assert.equal(s.el.scrollTop,600);
  s.scroll.reset();s.scroll.changed();assert.equal(s.el.scrollTop,900);
});
