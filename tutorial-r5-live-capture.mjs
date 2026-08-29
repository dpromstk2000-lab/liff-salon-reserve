import { chromium } from 'playwright';
import fs from 'node:fs/promises';

const BASE = process.env.DPRO_BASE || 'https://dpromstk2000-lab.github.io/liff-salon-reserve/';
const OUT = process.env.DPRO_OUT || 'r5-live-captures';
const BAD = new Set(['POST','PUT','PATCH','DELETE']);

await fs.rm(OUT,{recursive:true,force:true});
await fs.mkdir(OUT,{recursive:true});

const evidence = {
  revision: 'SALON-R5-LIVE-CAPTURE-V1.0-20260829',
  base: BASE,
  screenshots: [],
  pageerrors: [],
  consoleErrors: [],
  unsafeWrites: [],
  requestFailed: [],
  status: 'HOLD'
};

function track(page, label){
  page.on('pageerror', e => evidence.pageerrors.push({label,message:String(e)}));
  page.on('console', m => {
    if(m.type()==='error') evidence.consoleErrors.push({label,text:m.text()});
  });
  page.on('request', r => {
    if(BAD.has(r.method())) evidence.unsafeWrites.push({label,method:r.method(),url:r.url()});
  });
  page.on('requestfailed', r => evidence.requestFailed.push({
    label,method:r.method(),url:r.url(),failure:r.failure()?.errorText||''
  }));
}

async function shot(page,name,meta={}){
  const path = `${OUT}/${name}`;
  await page.screenshot({path,fullPage:false});
  evidence.screenshots.push({name,url:page.url(),...meta});
}

async function waitTutorial(page, step){
  await page.waitForFunction(expected => {
    const s=window.DPRO_TUTORIAL_QA?.snapshot?.();
    return s?.version==='SALON-TUTORIAL-R3-V1.2-20260828' &&
      s.status==='running' &&
      s.step===expected &&
      s.first10Count===10 &&
      s.card?.visible &&
      s.targetResolved &&
      s.highlight?.visible;
  }, step, {timeout:30000});
  return page.evaluate(()=>window.DPRO_TUTORIAL_QA.snapshot());
}

async function advanceTo(page, step){
  let s=await page.evaluate(()=>window.DPRO_TUTORIAL_QA.snapshot());
  while(s.step < step){
    await page.evaluate(()=>window.DPRO_TUTORIAL_QA.next());
    s=await waitTutorial(page,s.step+1);
  }
  return s;
}

const browser = await chromium.launch({headless:true});

try{
  const desktop = await browser.newContext({viewport:{width:1440,height:1000}});
  const p = await desktop.newPage();
  track(p,'tutorial-desktop');
  await p.goto(`${BASE}tutorial.html?qa=1&r5=1&b=${Date.now()}`,{waitUntil:'domcontentloaded',timeout:30000});
  await waitTutorial(p,1);
  await shot(p,'tutorial-step01-customer-1440x1000.png',{step:1,role:'CUSTOMER'});
  await advanceTo(p,4);
  await shot(p,'tutorial-step04-staff-1440x1000.png',{step:4,role:'STAFF'});
  await advanceTo(p,6);
  await shot(p,'tutorial-step06-owner-ipad-1440x1000.png',{step:6,role:'OWNER IPAD'});
  await advanceTo(p,8);
  await shot(p,'tutorial-step08-owner-pc-1440x1000.png',{step:8,role:'OWNER PC'});
  await advanceTo(p,10);
  await shot(p,'tutorial-step10-complete-point-1440x1000.png',{step:10,role:'OWNER PC'});

  const g = await desktop.newPage();
  track(g,'guide-desktop');
  await g.goto(`${BASE}guide-center.html?r5=1&b=${Date.now()}`,{waitUntil:'domcontentloaded',timeout:30000});
  await g.waitForFunction(()=>window.DPRO_GUIDE_CENTER_QA?.snapshot?.().count===10,{timeout:20000});
  await shot(g,'guide-center-1440x1000.png',{screen:'guide-center'});
  await g.click('#guide-start');
  await g.waitForFunction(()=>{
    const frame=document.getElementById('guide-tutorial-frame');
    const qa=frame?.contentWindow?.DPRO_TUTORIAL_QA;
    const s=qa?.snapshot?.();
    return s?.status==='running'&&s.step===1&&s.card?.visible&&s.targetResolved;
  },{timeout:30000});
  await shot(g,'guide-start-overlay-1440x1000.png',{screen:'guide-start'});
  await desktop.close();

  const mobile = await browser.newContext({
    viewport:{width:390,height:844},
    isMobile:true,
    hasTouch:true
  });
  const mp = await mobile.newPage();
  track(mp,'tutorial-mobile');
  await mp.goto(`${BASE}tutorial.html?qa=1&r5=1&b=${Date.now()}`,{waitUntil:'domcontentloaded',timeout:30000});
  await waitTutorial(mp,1);
  await shot(mp,'tutorial-step01-mobile-390x844.png',{step:1,role:'CUSTOMER',mobile:true});

  const mg = await mobile.newPage();
  track(mg,'guide-mobile');
  await mg.goto(`${BASE}guide-center.html?r5=1&b=${Date.now()}`,{waitUntil:'domcontentloaded',timeout:30000});
  await mg.waitForFunction(()=>window.DPRO_GUIDE_CENTER_QA?.snapshot?.().count===10,{timeout:20000});
  await shot(mg,'guide-center-mobile-390x844.png',{screen:'guide-center',mobile:true});
  await mobile.close();

  if(evidence.unsafeWrites.length) throw new Error(`Unsafe business writes detected: ${JSON.stringify(evidence.unsafeWrites)}`);
  if(evidence.pageerrors.length) throw new Error(`Page errors detected: ${JSON.stringify(evidence.pageerrors)}`);
  evidence.status='PASS';
}catch(err){
  evidence.error=String(err?.stack||err);
  throw err;
}finally{
  await browser.close();
  await fs.writeFile(`${OUT}/capture-evidence.json`,JSON.stringify(evidence,null,2));
  console.log(`R5_CAPTURE_RESULT=${JSON.stringify({
    revision:evidence.revision,
    screenshots:evidence.screenshots.length,
    pageerror:evidence.pageerrors.length,
    consoleError:evidence.consoleErrors.length,
    unsafeWrite:evidence.unsafeWrites.length,
    requestFailed:evidence.requestFailed.length,
    status:evidence.status
  })}`);
}
