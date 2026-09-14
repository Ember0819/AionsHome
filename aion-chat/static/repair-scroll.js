/* Repair chat: follow new content only while the reader chooses the bottom. */
(function(root){
  'use strict';
  function createRepairScroll(el,jump,schedule=requestAnimationFrame){
    let following=true,touching=false,lastTop=el.scrollTop,lastY=0,canResume=false;
    const atBottom=()=>el.scrollHeight-el.scrollTop-el.clientHeight<=4;
    function pause(){following=false;canResume=false;}
    function writeBottom(){el.scrollTop=el.scrollHeight;lastTop=el.scrollTop;jump.hidden=true;}
    function update(){if(following&&!touching)writeBottom();}
    function latest(){following=true;canResume=false;writeBottom();}
    el.addEventListener('wheel',event=>{canResume=event.deltaY>0;if(event.deltaY<0)pause();},{passive:true});
    el.addEventListener('touchstart',event=>{touching=true;lastY=event.touches[0]?.clientY||0;canResume=false;},{passive:true});
    el.addEventListener('touchmove',event=>{
      const y=event.touches[0]?.clientY??lastY;
      if(y>lastY+1)pause();else if(y<lastY-1)canResume=true;
      lastY=y;
    },{passive:true});
    function endTouch(){touching=false;if(canResume&&atBottom()){following=true;jump.hidden=true;}}
    el.addEventListener('touchend',endTouch,{passive:true});
    el.addEventListener('touchcancel',endTouch,{passive:true});
    el.addEventListener('pointerdown',event=>{if(event.pointerType==='mouse')canResume=true;});
    el.addEventListener('keydown',event=>{
      if(['ArrowUp','PageUp','Home'].includes(event.key)||(event.key===' '&&event.shiftKey))pause();
      else if(['ArrowDown','PageDown','End',' '].includes(event.key))canResume=true;
    });
    el.addEventListener('scroll',()=>{
      const top=el.scrollTop;
      if(top<lastTop-1)pause();
      else if(top>lastTop&&canResume&&atBottom()&&!touching){following=true;jump.hidden=true;canResume=false;}
      lastTop=top;
    },{passive:true});
    // Expanding a record is a deliberate reading action, not a request to jump.
    el.addEventListener('click',event=>{if(event.target.closest?.('summary'))pause();});
    el.addEventListener('load',()=>schedule(update),true);
    return {
      update,latest,
      layout:()=>schedule(update), // Check current intent when the frame runs.
      changed:()=>{if(!following||touching)jump.hidden=false;update();},
      reset:()=>{following=true;touching=false;canResume=false;lastTop=el.scrollTop;jump.hidden=true;}
    };
  }
  if(typeof module==='object'&&module.exports)module.exports=createRepairScroll;
  else root.createRepairScroll=createRepairScroll;
})(typeof window==='undefined'?globalThis:window);
