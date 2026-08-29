(() => {
'use strict';
const VERSION='SALON-GUIDE-CENTER-R4-V1.0-20260829';
const R3_VERSION='SALON-TUTORIAL-R3-V1.2-20260828';
const KEY='dpro_tutorial_salon_v1_1';
const GUIDES=[
{step:1,role:'CUSTOMER',route:'index.html?embed_demo=1',title:'製品紹介DEMOと予約状況を見る',primary:'#booking-list',fallback:'.container > h3.section-title:first-of-type'},
{step:2,role:'CUSTOMER',route:'index.html?embed_demo=1',title:'担当スタッフを選ぶ場所を確認',primary:'#select_staff',fallback:'select.input-box'},
{step:3,role:'CUSTOMER',route:'index.html?embed_demo=1',title:'予約日と空き時間の見方を確認',primary:'#time-slots',fallback:'#select_date'},
{step:4,role:'STAFF',route:'staff.html?embed_demo=1',title:'スタッフ画面で次の予約を確認',primary:'#next-booking-card',fallback:'.next-card'},
{step:5,role:'STAFF',route:'staff.html?embed_demo=1',title:'担当者別・日付別の確認方法を見る',primary:'#staff-selector',fallback:'select'},
{step:6,role:'OWNER IPAD',route:'owner-ipad.html?embed_demo=1',title:'iPadで今日・次営業日・今後を把握',primary:'#today-count',fallback:'.summary-grid'},
{step:7,role:'OWNER IPAD',route:'owner-ipad.html?embed_demo=1',title:'iPadで予約一覧と日付移動を見る',primary:'#booking-list',fallback:'main .panel .booking-list'},
{step:8,role:'OWNER PC',route:'owner.html?embed_demo=1',title:'オーナーPCの予約サマリーを見る',primary:'#today-count',fallback:'.grid-summary'},
{step:9,role:'OWNER PC',route:'owner.html?embed_demo=1',title:'オーナーPCの予約一覧を見る',primary:'#booking-list',fallback:'main .panel .booking-list'},
{step:10,role:'OWNER PC',route:'owner.html?embed_demo=1',title:'今日やることを確認して完了',primary:'#todo-list',fallback:'aside .panel .todo-list'}
];

const list=document.getElementById('guide-list');
const startBtn=document.getElementById('guide-start');
const resumeBtn=document.getElementById('guide-resume');
const replayBtn=document.getElementById('guide-replay');
const progress=document.getElementById('guide-progress');
const overlay=document.getElementById('guide-tutorial-overlay');
const frame=document.getElementById('guide-tutorial-frame');
const closeBtn=document.getElementById('guide-overlay-close');

let pendingAction=null;
let openToken=0;

function readState(){
  try{
    const s=JSON.parse(localStorage.getItem(KEY)||'null');
    return s&&s.version===R3_VERSION?s:null;
  }catch{return null}
}

function renderGuides(){
  list.innerHTML='';
  for(const g of GUIDES){
    const article=document.createElement('article');
    article.className='guide-card';
    article.dataset.step=String(g.step);
    article.dataset.route=g.route;
    article.dataset.primary=g.primary;
    article.dataset.fallback=g.fallback;
    article.innerHTML=`<div class="guide-card-top"><span class="guide-step">STEP ${g.step} / 10</span><span class="guide-role">${g.role}</span></div><h3>${g.title}</h3><p>${g.step<=3?'お客様画面':'業務画面'}の確認ポイントを安全な製品紹介モードで案内します。</p><div class="guide-path">${g.route}</div>`;
    list.appendChild(article);
  }
}

function refreshState(){
  const s=readState();
  const hasProgress=!!s&&['running','closed'].includes(s.status)&&Number(s.step)>0;
  const canReplay=!!s&&['complete','skipped'].includes(s.status);
  resumeBtn.hidden=!hasProgress;
  replayBtn.hidden=!canReplay;
  if(!s){progress.textContent='進捗：未開始';return}
  switch(s.status){
    case'running':progress.textContent=`進捗：${Number(s.step)+1} / 10 を確認中`;break;
    case'closed':progress.textContent=`進捗：${Number(s.step)+1} / 10 から再開できます`;break;
    case'complete':progress.textContent='進捗：10 / 10 完了';break;
    case'skipped':progress.textContent='進捗：スキップ済み。Replayで最初から確認できます';break;
    default:progress.textContent='進捗：未開始';
  }
}

function setOverlay(open){
  overlay.classList.toggle('is-open',open);
  overlay.setAttribute('aria-hidden',open?'false':'true');
  if(!open){
    pendingAction=null;
    openToken++;
    refreshState();
    startBtn.focus();
  }
}

function initialProductReady(){
  try{
    const tutorialDoc=frame.contentDocument;
    const productFrame=tutorialDoc?.getElementById('dpro-tutorial-frame');
    const productDoc=productFrame?.contentDocument;
    if(!productFrame||!productDoc||productDoc.readyState!=='complete')return false;
    const userDisplay=productDoc.getElementById('user-display');
    const bookingList=productDoc.getElementById('booking-list');
    return !!bookingList && /製品紹介デモ/.test(String(userDisplay?.textContent||''));
  }catch{return false}
}

async function callWhenReady(action,token,requireInitialProductReady){
  let productReadySince=0;
  for(let i=0;i<300;i++){
    if(token!==openToken)return;
    try{
      const qa=frame.contentWindow?.DPRO_TUTORIAL_QA;
      if(qa?.VERSION===R3_VERSION){
        let readyForAction=true;
        if(requireInitialProductReady){
          const nowReady=initialProductReady();
          if(nowReady){
            if(!productReadySince)productReadySince=Date.now();
            readyForAction=(Date.now()-productReadySince)>=400;
          }else{
            productReadySince=0;
            readyForAction=false;
          }
        }
        if(readyForAction){
          if(action==='start')qa.start();
          else if(action==='resume')qa.resume();
          else if(action==='replay')qa.replay();
          pendingAction=null;
          frame.focus();
          return;
        }
      }
    }catch{}
    await new Promise(r=>setTimeout(r,80));
  }
  throw new Error('Tutorial runtime or initial product frame unavailable');
}

function openTutorial(action){
  pendingAction=action;
  const token=++openToken;
  overlay.classList.add('is-open');
  overlay.setAttribute('aria-hidden','false');

  let runtimeReady=false;
  try{runtimeReady=frame.contentWindow?.DPRO_TUTORIAL_QA?.VERSION===R3_VERSION}catch{}

  const requireInitialProductReady=!runtimeReady;
  if(!runtimeReady){
    frame.src=`tutorial.html?guide_center=1&b=${Date.now()}`;
  }

  callWhenReady(action,token,requireInitialProductReady).catch(err=>{
    console.error(err);
    progress.textContent='チュートリアルを開けませんでした。ページを再読込してください。';
  });
}

function closeOverlay(){setOverlay(false)}

startBtn.addEventListener('click',()=>openTutorial('start'));
resumeBtn.addEventListener('click',()=>openTutorial('resume'));
replayBtn.addEventListener('click',()=>openTutorial('replay'));
closeBtn.addEventListener('click',closeOverlay);

window.addEventListener('keydown',e=>{
  if(e.key==='Escape'&&overlay.classList.contains('is-open')){
    e.preventDefault();
    closeOverlay();
  }
});
window.addEventListener('storage',refreshState);
window.addEventListener('focus',refreshState);

renderGuides();
refreshState();

window.DPRO_GUIDE_CENTER_QA={
  VERSION,
  R3_VERSION,
  KEY,
  GUIDES:Object.freeze(GUIDES.map(x=>({...x}))),
  readState,
  refreshState,
  open:openTutorial,
  close:closeOverlay,
  snapshot:()=>({
    version:VERSION,
    r3Version:R3_VERSION,
    count:GUIDES.length,
    overlayOpen:overlay.classList.contains('is-open'),
    resumeVisible:!resumeBtn.hidden,
    replayVisible:!replayBtn.hidden,
    progress:progress.textContent,
    docScrollWidth:document.documentElement.scrollWidth,
    bodyScrollWidth:document.body?.scrollWidth||0,
    innerWidth,
    innerHeight
  })
};
})();
