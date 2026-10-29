import test from 'node:test';
import assert from 'node:assert/strict';
import {checkSubscriptionConnection} from '../../static/calendar-reminders/connection-check.mjs';
import {normalizeGuideState} from '../../static/calendar-reminders/subscription-guide.mjs';

const apiBaseUrl='https://calendar.example';
const feedUrl=`${apiBaseUrl}/calendar/${'r'.repeat(43)}.ics`;
const healthy=()=>Response.json({status:'ok',appVersion:'test',dataVersion:'test'});
const ics='BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Test//ZH\r\nEND:VCALENDAR\r\n';
const calendar=(text=ics)=>new Response(text,{headers:{'Content-Type':'text/calendar; charset=utf-8'}});
const check=(options={})=>checkSubscriptionConnection({apiBaseUrl,feedUrl,...options});
const sequence=responses=>async()=>responses.shift();

test('connection checks health and actual ICS using only the trusted public URL',async()=>{
  const calls=[];
  const result=await check({now:()=>new Date('2026-10-29T10:00:00Z'),fetchImpl:async(url,options)=>{
    calls.push({url,options});return url.endsWith('/healthz')?healthy():calendar();
  }});
  assert.equal(result.state,'ok');
  assert.equal(result.checkedAt,'2026-10-29T10:00:00.000Z');
  assert.deepEqual(calls.map(call=>call.url),[`${apiBaseUrl}/healthz`,feedUrl]);
  for(const {options} of calls){
    assert.equal(options.credentials,'omit');assert.equal(options.redirect,'error');
    assert.equal(options.cache,'no-store');assert.equal(options.referrerPolicy,'no-referrer');
    assert.deepEqual(Object.keys(options.headers),['Accept']);
  }
  assert.match(result.message,/本网页/);
  assert.doesNotMatch(result.message,/订阅成功/);
});

test('rejects other origins, credentials, insecure public URLs, query tokens and non-feed routes without requests',async()=>{
  let calls=0;const fetchImpl=async()=>{calls++;return healthy();};
  for(const url of [feedUrl.replace('calendar.example','elsewhere.example'),feedUrl+'?manageToken=secret',feedUrl+'#secret',
    feedUrl.replace('https://','https://user:password@'),`${apiBaseUrl}/api/subscriptions/secret`,feedUrl.replace('https:','http:')]){
    assert.equal((await check({feedUrl:url,fetchImpl})).code,'address');
  }
  assert.equal((await check({apiBaseUrl:apiBaseUrl+'/path',fetchImpl})).code,'address');
  assert.equal(calls,0);
});

test('only HTTP loopback is permitted for isolated local browser acceptance',async()=>{
  const local='http://127.0.0.1:4173';
  assert.equal((await check({apiBaseUrl:local,feedUrl:feedUrl.replace(apiBaseUrl,local),fetchImpl:sequence([healthy(),calendar()])})).state,'ok');
});

test('distinguishes unhealthy service, feed failure, HTML and truncated calendar responses',async()=>{
  for(const [responses,code] of [
    [[new Response('unavailable',{status:503})],'service'],
    [[Response.json({status:'maintenance'})],'service'],
    [[new Response('<html>Login</html>')],'format'],
    [[healthy(),new Response('missing',{status:404})],'feed'],
    [[healthy(),new Response('<html>challenge</html>',{headers:{'Content-Type':'text/html'}})],'format'],
    [[healthy(),calendar('<html>challenge</html>')],'format'],
    [[healthy(),calendar('BEGIN:VCALENDAR\r\nVERSION:2.0\r\n')],'format'],
    [[healthy(),calendar('BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n')],'format']
  ]) assert.equal((await check({fetchImpl:sequence(responses)})).code,code);
});

test('timeout includes a response body that never finishes and closes its reader',async()=>{
  let cancelled=false;
  const streaming=new Response(new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode('BEGIN:VCALENDAR\r\n'));},cancel(){cancelled=true;}}),{headers:{'Content-Type':'text/calendar'}});
  const start=Date.now();
  const result=await check({timeoutMs:30,fetchImpl:sequence([healthy(),streaming])});
  assert.equal(result.code,'timeout');assert.equal(cancelled,true);assert.ok(Date.now()-start<1000);
  assert.match(result.message,/地址已保留/);
});

test('abort invalidates an in-flight body check without reporting a user-facing connection failure',async()=>{
  const controller=new AbortController();
  const stream=new Response(new ReadableStream(),{headers:{'Content-Type':'text/calendar'}});
  const promise=check({signal:controller.signal,fetchImpl:sequence([healthy(),stream])});
  setTimeout(()=>controller.abort(),15);
  assert.equal((await promise).state,'cancelled');
  assert.equal((await check({signal:controller.signal,fetchImpl:async()=>assert.fail('already aborted')})).state,'cancelled');
});

test('network rejection and excessive response size produce distinct actionable failures',async()=>{
  assert.equal((await check({fetchImpl:async()=>{throw new TypeError('Failed to fetch');}})).code,'network');
  const result=await check({fetchImpl:sequence([healthy(),calendar('x'.repeat(2*1024*1024+1))])});
  assert.equal(result.code,'format');assert.match(result.message,/文件导入/);
});

test('Outlook help progress is browser state independent of other app confirmations',()=>{
  const result=normalizeGuideState({app:'outlook',progress:{outlook:{seen:true,reminders:false},iphone:{seen:false}},expanded:{outlook:true}});
  assert.equal(result.app,'outlook');assert.deepEqual(result.progress.outlook,{seen:true,reminders:false});
  assert.equal(result.progress.iphone.seen,false);assert.equal(result.expanded.outlook,true);
});
