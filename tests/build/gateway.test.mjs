import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createGateway, GATEWAY_FAILURE_STAGES} from '../../service/gateway/gateway.mjs';

const base='https://huideng-calendar-acceptance.pages.dev';
const release={version:'a'.repeat(40),dataVersion:'b'.repeat(64),environment:'acceptance'};
const gateway=createGateway(release);
const request=(path,options={})=>new Request(base+path,options);
const health=()=>Response.json({status:'ok',...release});
const env=fetch=>({PUBLIC_BASE_URL:base,CALENDAR_SERVICE:{fetch}});

test('Pages forwards request bodies, authorization, origin and idempotency over the binding only',async()=>{
 const body=JSON.stringify({settings:{zone:'Asia/Shanghai'}});
 const incoming=request('/api/subscriptions',{method:'POST',body,headers:{Authorization:'Bearer test',Origin:base,'Idempotency-Key':'key','CF-Connecting-IP':'203.0.113.8'}});
 const response=await gateway.fetch(incoming,env(async bound=>{
  assert.equal(bound.url,incoming.url);assert.equal(bound.method,'POST');assert.equal(await bound.text(),body);
  for(const key of ['Authorization','Origin','Idempotency-Key','CF-Connecting-IP'])assert.equal(bound.headers.get(key),incoming.headers.get(key));
  return Response.json({revision:1},{status:201,headers:{'Cache-Control':'public'}});
 }));
 assert.equal(response.status,201);assert.equal(response.headers.get('cache-control'),'no-store');
 assert.equal(response.headers.get('strict-transport-security'),'max-age=31536000');
});

test('Pages streams calendar bodies and preserves HEAD, ETag, 304 and cancellation data',async()=>{
 const path=`/calendar/${'x'.repeat(43)}.ics`;
 let boundCalls=0;
 const bindings=env(async req=>{
  boundCalls++;
  if(req.headers.get('if-none-match')==='"one"')return new Response(null,{status:304,headers:{ETag:'"one"'}});
  return new Response(req.method==='HEAD'?null:'BEGIN:VCALENDAR\r\nSTATUS:CANCELLED\r\nEND:VCALENDAR\r\n',{headers:{ETag:'"one"','Content-Type':'text/calendar','Cache-Control':'private, max-age=300'}});
 });
 const get=await gateway.fetch(request(path),bindings);
 assert.equal(get.headers.get('etag'),'"one"');assert.equal(get.headers.get('cache-control'),'private, max-age=300');
 assert.match(await get.text(),/STATUS:CANCELLED/);
 assert.equal(await (await gateway.fetch(request(path,{method:'HEAD'}),bindings)).text(),'');
 const cached=await gateway.fetch(request(path,{headers:{'If-None-Match':'"one"'}}),bindings);
 assert.equal(cached.status,304);assert.equal(await cached.text(),'');assert.equal(boundCalls,3);
});

test('a successful ICS response is passed through without buffering the calendar body',async()=>{
 let reads=0;
 const stream=new ReadableStream({pull(controller){reads++;controller.enqueue(new TextEncoder().encode('BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n'));controller.close();}},{highWaterMark:0});
 const response=await gateway.fetch(request(`/calendar/${'x'.repeat(43)}.ics`),env(async()=>new Response(stream,{headers:{'Content-Type':'text/calendar'}})));
 assert.equal(reads,0);assert.match(await response.text(),/^BEGIN:VCALENDAR/);assert.equal(reads,1);
});

test('gateway health verifies commit, date data and environment without exposing extra backend fields',async()=>{
 const response=await gateway.fetch(request('/healthz'),env(async()=>Response.json({status:'ok',...release,secret:'must not return'})));
 assert.deepEqual(await response.json(),{status:'ok',...release,gatewayVersion:release.version});
 for(const mismatch of [{environment:'trial'},{version:'c'.repeat(40)},{dataVersion:'d'.repeat(64)},{status:'failed'}]){
  const failed=await gateway.fetch(request('/healthz'),env(async()=>Response.json({status:'ok',...release,...mismatch})));
  assert.equal(failed.status,503);assert.match((await failed.json()).error,/暂时无法连接/);
  assert.equal(failed.headers.get('x-calendar-gateway-stage'),'health_mismatch');
 }
 const head=await gateway.fetch(request('/healthz',{method:'HEAD'}),env(async req=>{assert.equal(req.method,'GET');return health();}));
 assert.equal(head.status,200);assert.equal(await head.text(),'');
});

test('missing bindings, HTML and redirects fail closed without returning Worker URLs or raw errors',async()=>{
 for(const [stage,bindings] of [['binding_missing',{PUBLIC_BASE_URL:base}],['binding_fetch',env(async()=>{throw new Error('https://secret.invalid/token');})],
   ['health_payload',env(async()=>new Response('login',{headers:{'Content-Type':'text/html'}}))],
   ['unexpected_redirect',env(async()=>new Response(null,{status:302,headers:{Location:'https://secret.workers.dev/calendar/token.ics'}}))]]){
  const response=await gateway.fetch(request('/healthz'),bindings);
  assert.equal(response.status,503);assert.doesNotMatch(await response.text(),/secret|<html|login/);
  assert.equal(response.headers.get('location'),null);
  assert.equal(response.headers.get('x-calendar-gateway-stage'),stage);
 }
});

test('calendar and management endpoints cannot return HTML while JSON errors retain their status',async()=>{
 for(const path of ['/api/subscriptions',`/calendar/${'x'.repeat(43)}.ics`]){
  for(const status of [200,502]){
   const response=await gateway.fetch(request(path),env(async()=>new Response('<html>challenge</html>',{status,headers:{'Content-Type':'text/html'}})));
   assert.equal(response.status,503);assert.equal(response.headers.get('content-type'),'application/json; charset=utf-8');
   assert.equal(response.headers.get('x-calendar-gateway-stage'),'unexpected_response_type');
   assert.doesNotMatch(await response.text(),/challenge|<html/);
  }
  const response=await gateway.fetch(request(path),env(async()=>Response.json({error:'请稍后重试。'},{status:429,headers:{'Retry-After':'5'}})));
  assert.equal(response.status,429);assert.equal(response.headers.get('retry-after'),'5');
  assert.equal((await response.json()).error,'请稍后重试。');
 }
 const options=await gateway.fetch(request('/api/subscriptions',{method:'OPTIONS'}),env(async()=>new Response(null,{status:204,headers:{'Access-Control-Allow-Origin':base}})));
 assert.equal(options.status,204);assert.equal(options.headers.get('access-control-allow-origin'),base);
});

test('safe failure stages distinguish thrown feed calls from invalid responses without retries or private details',async()=>{
 const path=`/calendar/${'x'.repeat(43)}.ics?private=must-not-return`;
 for(const method of ['GET','HEAD']){
  let calls=0;
  const response=await gateway.fetch(request(path,{method,headers:{Authorization:'Bearer must-not-return'}}),env(async()=>{
   calls++;throw new Error('private https://example.invalid/calendar/secret.ics Authorization: Bearer must-not-return');
  }));
  assert.equal(calls,1,'diagnosis must not retry a failed subscription request');
  assert.equal(response.status,503);
  assert.equal(response.headers.get('x-calendar-gateway-stage'),'binding_fetch');
  assert.equal(response.headers.get('cache-control'),'no-store');
  assert.equal(response.headers.get('strict-transport-security'),'max-age=31536000');
  const body=await response.text();
  if(method==='HEAD')assert.equal(body,'');
  else assert.deepEqual(JSON.parse(body),{error:'暂时无法连接订阅服务，请稍后重试。'});
  assert.doesNotMatch(body+JSON.stringify([...response.headers]),/secret|private|Authorization|Bearer|must-not-return/);
 }
 assert.ok(Object.isFrozen(GATEWAY_FAILURE_STAGES));
 assert.ok(!GATEWAY_FAILURE_STAGES.includes('https://secret.invalid/token'));
});

test('failure stages remain request-local and backend-provided diagnostic labels are never propagated',async()=>{
 let releaseBinding;
 const waiting=new Promise(resolve=>{releaseBinding=resolve;});
 const pending=gateway.fetch(request(`/calendar/${'x'.repeat(43)}.ics`),env(async()=>{await waiting;throw new Error('private');}));
 const badHealth=await gateway.fetch(request('/healthz'),env(async()=>Response.json({status:'ok',...release,environment:'trial'})));
 releaseBinding();
 assert.equal(badHealth.headers.get('x-calendar-gateway-stage'),'health_mismatch');
 assert.equal((await pending).headers.get('x-calendar-gateway-stage'),'binding_fetch');
 for(const status of [200,503]){
  const response=await gateway.fetch(request('/api/subscriptions'),env(async()=>Response.json(
   status===200?{revision:1}:{error:'订阅服务暂时不可用，请稍后再试。'},
   {status,headers:{'X-Calendar-Gateway-Stage':'private-token-or-fake-phase'}})));
  assert.equal(response.status,status);
  assert.equal(response.headers.get('x-calendar-gateway-stage'),null);
 }
});

test('transport guards reject insecure writes and host spoofing before invoking the backend',async()=>{
 let calls=0;const bindings=env(async()=>{calls++;return health();});
 const redirect=await gateway.fetch(new Request(base.replace('https:','http:')+'/healthz'),bindings);
 assert.equal(redirect.status,308);assert.equal(redirect.headers.get('location'),base+'/healthz');
 assert.equal(redirect.headers.get('strict-transport-security'),null);
 const write=await gateway.fetch(new Request(base.replace('https:','http:')+'/api/subscriptions',{method:'POST'}),bindings);
 assert.equal(write.status,400);
 assert.equal((await gateway.fetch(new Request('https://attacker.invalid/healthz'),bindings)).status,404);
 assert.equal(calls,0);
 const local=await gateway.fetch(new Request('http://127.0.0.1:4173/healthz'),{...bindings,PUBLIC_BASE_URL:'http://127.0.0.1:4173',ALLOW_LOCAL_DEV:'true'});
 assert.equal(local.status,200);assert.equal(calls,1);
});

test('unknown dynamic paths never fall back to HTML while static assets use ASSETS',async()=>{
 let staticCalls=0;
 const bindings={...env(async()=>health()),ASSETS:{fetch:async()=>{staticCalls++;return new Response('asset');}}};
 assert.equal((await gateway.fetch(request('/api/unknown'),bindings)).status,404);
 assert.equal((await gateway.fetch(request('/calendar/invalid.ics'),bindings)).status,404);
 assert.equal(staticCalls,0);
 assert.equal(await (await gateway.fetch(request('/calendar-reminders/style.css'),bindings)).text(),'asset');
 assert.equal(staticCalls,1);
});
