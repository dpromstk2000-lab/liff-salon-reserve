(() => {
  'use strict';
  const C = {
    API: 'https://dpro-salon-line-api.dpromstk2000.workers.dev',
    AUTH: 'https://dpro-owner-auth-general.dpromstk2000.workers.dev',
    SYSTEM: 'SALON',
    FACILITY: 'dpro_salon_demo',
    FRONTEND_VERSION: 'SALON-FRONTEND-API3-20260822',
    OWNER_KEY: 'dpro_salon_owner_session',
    STAFF_KEY: 'dpro_salon_staff_view_session',
    LIFF_ID: '2010243135-H06VsAHm'
  };
  const q = id => document.getElementById(id);
  const clean = v => String(v ?? '').trim();
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const isEmbed = () => new URLSearchParams(location.search).get('embed_demo') === '1';
  const isGuideTutorial = () => {
    try {
      return isEmbed() && parent !== window &&
        new URLSearchParams(parent.location.search).get('guide_center') === '1';
    } catch {
      return false;
    }
  };
  const dateStr = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  const parseDate = s => { const [y,m,d]=String(s).split('-').map(Number); return new Date(y,m-1,d); };
  const addDays = (s,n) => { const d=parseDate(s); d.setDate(d.getDate()+n); return dateStr(d); };
  const addMonths = (s,n) => { const d=parseDate(s); d.setMonth(d.getMonth()+n); return dateStr(d); };
  const today = () => dateStr(new Date());
  const fmtDate = s => { if(!s)return ''; const d=parseDate(s); return `${d.getMonth()+1}月${d.getDate()}日（${['日','月','火','水','木','金','土'][d.getDay()]}）`; };
  const fmtDateTime = v => { const [d,t='']=String(v||'').split('T'); return `${fmtDate(d)} ${t.slice(0,5)}`; };
  const timeOf = v => String(v||'').split('T')[1]?.slice(0,5) || '--:--';
  const apiError = (data,status) => { const e=new Error(data?.message || data?.error || `HTTP ${status}`); e.code=data?.error || ''; e.status=status; e.data=data; return e; };
  async function json(url, opts={}) {
    const headers = new Headers(opts.headers || {});
    if (opts.body && !headers.has('Content-Type')) headers.set('Content-Type','application/json');
    headers.set('Accept','application/json');
    const res=await fetch(url,{...opts,headers});
    const text=await res.text(); let data={}; try{data=text?JSON.parse(text):{}}catch{data={raw:text}}
    if(!res.ok || data?.ok===false) throw apiError(data,res.status);
    return data;
  }
  function guideBootstrap() {
    return {
      ok: true,
      settings: {
        open_time: '10:00',
        close_time: '19:00',
        regular_holidays: ''
      },
      staffs: [],
      closedDays: []
    };
  }
  async function publicBootstrap(from=today(),to=addMonths(from,2)){
    if (isGuideTutorial()) return guideBootstrap();
    return json(`${C.API}/api/public/bootstrap?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
  }
  async function availability(date,staff=''){
    if (isGuideTutorial()) return {ok:true,date,staff,occupied:[]};
    return json(`${C.API}/api/public/availability?date=${encodeURIComponent(date)}&staff=${encodeURIComponent(staff)}`);
  }
  function ownerToken(){return sessionStorage.getItem(C.OWNER_KEY)||''}
  function setOwnerToken(t){ if(t)sessionStorage.setItem(C.OWNER_KEY,t); else sessionStorage.removeItem(C.OWNER_KEY); }
  async function owner(path,opts={}){ const t=ownerToken(); if(!t) throw apiError({error:'owner_session_required',message:'オーナーログインが必要です。'},401); const h=new Headers(opts.headers||{}); h.set('Authorization',`Bearer ${t}`); return json(`${C.API}${path}`,{...opts,headers:h}); }
  async function ownerLogin(password){
    const data=await json(`${C.AUTH}/auth/login`,{method:'POST',body:JSON.stringify({systemCode:C.SYSTEM,facilityCode:C.FACILITY,password:String(password||''),rememberMe:false})});
    if(!data.sessionToken) throw new Error('オーナーセッションを取得できませんでした。'); setOwnerToken(data.sessionToken); return data;
  }
  async function ownerLogout(){ const t=ownerToken(); setOwnerToken(''); if(!t)return; try{await json(`${C.AUTH}/auth/logout`,{method:'POST',headers:{Authorization:`Bearer ${t}`}})}catch{} }
  async function ownerSession(){return owner('/api/owner/session')}
  async function ownerBootstrap(date=today()){return owner(`/api/owner/bootstrap?date=${encodeURIComponent(date)}`)}
  async function issueStaff(){return owner('/api/owner/staff-view-session',{method:'POST',body:'{}'})}
  function staffToken(){return sessionStorage.getItem(C.STAFF_KEY)||''}
  function setStaffToken(t){if(t)sessionStorage.setItem(C.STAFF_KEY,t);else sessionStorage.removeItem(C.STAFF_KEY)}
  async function staffBootstrap(date=today()){ const t=staffToken(); if(!t) throw apiError({error:'staff_session_required',message:'スタッフ閲覧セッションが必要です。'},401); return json(`${C.API}/api/staff/bootstrap?date=${encodeURIComponent(date)}`,{headers:{Authorization:`Bearer ${t}`}}); }
  function takeStaffHash(){ const raw=location.hash.startsWith('#token=')?decodeURIComponent(location.hash.slice(7)):''; if(raw){setStaffToken(raw);history.replaceState(null,'',location.pathname+location.search);} return raw; }
  function regularSet(settings){return new Set(clean(settings?.regular_holidays).split(',').filter(Boolean));}
  function closedMap(rows){return new Map((rows||[]).map(r=>[r.closed_date,r]));}
  function isClosed(date,settings,closedDays){ const d=parseDate(date); const c=closedMap(closedDays).get(date); if(c)return {closed:true,reason:`臨時休業：${clean(c.reason)||'理由なし'}`}; if(regularSet(settings).has(String(d.getDay())))return {closed:true,reason:'定休日'}; return {closed:false,reason:''}; }
  function nextBusiness(from,settings,closedDays){ for(let i=1;i<=60;i++){const d=addDays(from,i); if(!isClosed(d,settings,closedDays).closed)return d;} return ''; }
  function slots(settings){ const [oh,om]=String(settings?.open_time||'10:00').split(':').map(Number); const [ch,cm]=String(settings?.close_time||'19:00').split(':').map(Number); const out=[]; for(let m=oh*60+om;m<ch*60+cm;m+=30)out.push(`${String(Math.floor(m/60)).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`); return out; }
  function message(id,text,type=''){ const e=q(id); if(!e)return; e.textContent=text||''; if(e.classList.contains('message')) e.className=`message${text?' show':''}${type?' '+type:''}`; }
  function demoBanner(){ if(!isEmbed())return; let b=q('embed-demo-banner'); if(!b){b=document.createElement('div');b.id='embed-demo-banner';b.style.cssText='position:sticky;top:0;z-index:9999;padding:9px 14px;text-align:center;background:#fff3cd;border-bottom:1px solid #e8cf79;color:#6a5210;font-size:12px;font-weight:800';b.textContent='製品紹介用デモ表示です。閲覧・画面操作はできますが、個人情報表示・登録・変更・削除は実行されません。';document.body.prepend(b);} else b.style.display='block'; }
  function authMessage(err){ if(err?.code==='LOGIN_FAILED') return 'オーナーアカウントが未登録、または管理コードが違います。SALONの実契約アカウントは契約時に発行します。公開DEMOは製品サイトの「ページ内で操作する」から確認できます。'; if(err?.code==='ORIGIN_NOT_ALLOWED') return '共通Owner Authの許可Origin確認が必要です。CENTRALへ返却してください。'; return err?.message || 'ログインに失敗しました。'; }
  window.SALON3={...C,q,clean,esc,isEmbed,isGuideTutorial,dateStr,parseDate,addDays,addMonths,today,fmtDate,fmtDateTime,timeOf,json,publicBootstrap,availability,ownerToken,setOwnerToken,owner,ownerLogin,ownerLogout,ownerSession,ownerBootstrap,issueStaff,staffToken,setStaffToken,staffBootstrap,takeStaffHash,isClosed,nextBusiness,slots,message,demoBanner,authMessage};
})();
