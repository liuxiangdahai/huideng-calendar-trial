// Reproducible local benchmark. This is a synthetic Chrome baseline, not field INP.
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {gzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {chromium} from '@playwright/test';

const label=process.argv[2]||'baseline';
if(!/^[a-z0-9-]+$/.test(label))throw new Error('Use a simple report label.');
const directory=path.resolve('artifacts/performance');await fs.mkdir(directory,{recursive:true});
const site=path.resolve('dist/site');
const manifest=await fs.readFile('dist/manifest.json');
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.jpg':'image/jpeg','.png':'image/png','.svg':'image/svg+xml'};
const server=http.createServer(async(req,res)=>{
 try {
  let pathname=new URL(req.url,'http://localhost').pathname;if(pathname==='/')pathname='/calendar-reminders/index.html';if(pathname.endsWith('/'))pathname+='index.html';
  const target=path.resolve(site,'.'+pathname);if(!target.startsWith(site+path.sep)){res.writeHead(403);res.end();return;}
  const bytes=await fs.readFile(target);const encoded=gzipSync(bytes);
  res.writeHead(200,{'Content-Type':mime[path.extname(target)]||'application/octet-stream','Content-Encoding':'gzip','Content-Length':encoded.length,'Cache-Control':'no-store'});res.end(encoded);
 }catch{res.writeHead(404);res.end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const url=`http://127.0.0.1:${server.address().port}/calendar-reminders/`;
const browser=await chromium.launch({channel:'chrome',headless:true});
const report={label,date:new Date().toISOString(),status:'running',environment:{os:os.type()+' '+os.release(),cpu:os.cpus()[0].model,browser:browser.version(),viewport:{width:390,height:844},timezone:'Asia/Singapore',cpuSlowdown:4,network:{downBitsPerSecond:1600000,upBitsPerSecond:750000,latencyMs:150},serving:'local HTTP + gzip; formal dist/site; not production delivery',manifestSHA256:createHash('sha256').update(manifest).digest('hex')},cold:[],interactions:{},errors:[]};
const percentile=(values,p)=>{const ordered=[...values].sort((a,b)=>a-b);return ordered[Math.max(0,Math.ceil(ordered.length*p)-1)]??null};
const stats=values=>({count:values.length,p50:percentile(values,.5),p95:percentile(values,.95),max:values.length?Math.max(...values):null});
async function prepare(){
 const context=await browser.newContext({viewport:report.environment.viewport,timezoneId:report.environment.timezone});
 await context.addInitScript(()=>{
  window.measure={events:[],longTasks:[],lcp:[],shifts:[],samples:[],current:null,observers:[]};
  const observe=(type,key,project,extra={})=>{const obs=new PerformanceObserver(list=>measure[key].push(...list.getEntries().map(project)));obs.observe({type,buffered:true,...extra});measure.observers.push({obs,key,project})};
  observe('event','events',e=>({type:e.name,start:e.startTime,duration:e.duration,processing:e.processingEnd-e.processingStart,interactionId:e.interactionId}),{durationThreshold:16});
  observe('longtask','longTasks',e=>({start:e.startTime,duration:e.duration}));
  observe('largest-contentful-paint','lcp',e=>({start:e.startTime,size:e.size,element:e.element?.id||e.element?.className}));
  observe('layout-shift','shifts',e=>({start:e.startTime,value:e.value,recentInput:e.hadRecentInput,sources:e.sources.map(s=>({element:s.node?.id||s.node?.className||s.node?.tagName,previous:s.previousRect.toJSON(),current:s.currentRect.toJSON()}))}));
  window.flushMeasures=()=>{for(const {obs,key,project} of measure.observers)measure[key].push(...obs.takeRecords().map(project))};
  for(const type of ['click','keydown'])document.addEventListener(type,event=>{
   const current=measure.current;if(!current||current.started||type!==current.type)return;
   current.started=true;current.eventStart=event.timeStamp;current.dispatched=performance.now();
   requestAnimationFrame(()=>requestAnimationFrame(()=>{current.afterPaint=performance.now();measure.samples.push({...current});current.complete=true}));
  },true);
 });
 const page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));
 const cdp=await context.newCDPSession(page);
 await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});
 await cdp.send('Network.enable');await cdp.send('Network.setCacheDisabled',{cacheDisabled:true});
 await cdp.send('Network.emulateNetworkConditions',{offline:false,latency:150,downloadThroughput:200000,uploadThroughput:93750,connectionType:'cellular3g'});
 await page.goto(url);await page.locator('#app:not([hidden])').waitFor();
 return {context,page,cdp};
}
async function sample(page,name,index,action,type='click'){
 await page.evaluate(({name,index,type})=>{measure.current={name,index,type,armed:performance.now()}},{name,index,type});
 await action();await page.waitForFunction(()=>measure.current?.complete);
 await page.waitForTimeout(120); // allow buffered Event Timing to arrive, not part of measured duration
 return page.evaluate(()=>{flushMeasures();const m=measure.current;const native=measure.events.filter(e=>e.start>=m.armed&&e.start<=m.afterPaint&&e.interactionId);const tasks=measure.longTasks.filter(e=>e.start>=m.armed&&e.start<=m.afterPaint);measure.current=null;return {...m,frameEstimateMs:m.afterPaint-m.eventStart,nativeEventTiming:native,nativeMs:native.length?Math.max(...native.map(e=>e.duration)):null,longTasks:tasks}});
}
async function series(page,name,action,type='click',after=async()=>{}){
 const samples=[];for(let index=0;index<30;index++){samples.push(await sample(page,name,index,()=>action(index),type));await after()}
 report.interactions[name]={frameEstimate:stats(samples.map(s=>s.frameEstimateMs)),eventTiming:stats(samples.flatMap(s=>s.nativeMs===null?[]:[s.nativeMs])),samplesWithoutEventTiming:samples.filter(s=>s.nativeMs===null).length,longTaskMaximumMs:Math.max(0,...samples.flatMap(s=>s.longTasks.map(t=>t.duration))),samples};
 console.log(name,JSON.stringify({frame:report.interactions[name].frameEstimate,eventTiming:report.interactions[name].eventTiming,longTask:report.interactions[name].longTaskMaximumMs}));
}
try{
 for(let index=0;index<5;index++){
  const {context,page}=await prepare();await page.waitForTimeout(1200);
  const metric=await page.evaluate(()=>{flushMeasures();let max=0,sum=0,first=0,last=0;for(const shift of measure.shifts.filter(s=>!s.recentInput)){if(!last||shift.start-last>1000||shift.start-first>5000){sum=0;first=shift.start}sum+=shift.value;last=shift.start;max=Math.max(max,sum)}return {lcp:measure.lcp.at(-1),cls:max,shifts:measure.shifts,longTasks:measure.longTasks,navigation:performance.getEntriesByType('navigation')[0].toJSON()}});
  report.cold.push(metric);await context.close();console.log('cold',index+1,metric.lcp?.start,metric.cls);
 }
 if(!process.argv.includes('--cold-only')){
 const {context,page,cdp}=await prepare();await page.waitForTimeout(500);
 await series(page,'preset',i=>page.locator(`[data-preset=${i%2?'guru':'practice'}]`).click());
 await series(page,'checkbox',()=>page.locator('#event-dakini-tsok').click());
 await series(page,'category',()=>page.locator('[data-group-id="masters"]>summary').click());
 await page.locator('[data-preset=practice]').click();await page.locator('#tab-preview').click();
 await series(page,'month',i=>page.locator(`[data-cal-action=${i%2?'previous':'next'}]`).click());
 await series(page,'view',i=>page.locator(`[data-cal-view=${i%2?'month':'list'}]`).click());
 await page.locator('#tab-selection').click();
 await series(page,'open-reminder',()=>page.locator('[data-reminder-event="guru-tsok"]').click(),'click',()=>page.locator('[aria-label="关闭提醒设置"]').click());
 // Separate diagnostic profile; its instrumentation is outside measured samples.
 await cdp.send('Profiler.enable');await cdp.send('Profiler.start');
 for(let i=0;i<6;i++)await page.locator(`[data-preset=${i%2?'guru':'practice'}]`).click();
 const {profile}=await cdp.send('Profiler.stop');await fs.writeFile(path.join(directory,`${label}.cpuprofile`),JSON.stringify(profile));
 await context.close();
 }
 report.status='measured';
}catch(error){report.status='failed';report.failure=error.message;throw error}finally{
 report.coldSummary={lcp:stats(report.cold.flatMap(c=>c.lcp?[c.lcp.start]:[])),cls:stats(report.cold.map(c=>c.cls))};
 await fs.writeFile(path.join(directory,`${label}.json`),JSON.stringify(report,null,2));
 await browser.close();await new Promise(resolve=>server.close(resolve));
}
