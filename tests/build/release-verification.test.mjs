import {test} from 'node:test';
import assert from 'node:assert/strict';
import {verifyReleaseOnce,waitForRelease} from '../../tools/calendar/verify-release-core.mjs';

const api='https://huideng-calendar-acceptance.pages.dev';
const current={version:'a'.repeat(40),dataVersion:'b'.repeat(64),environment:'acceptance'};
const oldVersion='c'.repeat(40);
const options={api,site:api,version:current.version};
const json=body=>Response.json(body,{headers:{'Strict-Transport-Security':'max-age=31536000'}});
const health=(extra={})=>json({status:'ok',...current,gatewayVersion:current.version,...extra});
const validResource=(url)=>{
  const pathname=new URL(url).pathname;
  if(pathname==='/healthz')return health();
  if(pathname==='/version.json')return json(current);
  if(pathname==='/calendar-reminders/config.json')return json({apiBaseUrl:api});
  if(pathname==='/calendar-reminders/')return new Response(`<meta name="calendar-build" content="${current.version}">`);
  throw new Error('Unexpected read path: '+pathname);
};

test('release verification waits for a stale Worker version to converge without accepting the stale result',async()=>{
  let calls=0;const delays=[],notices=[];
  const result=await waitForRelease({api,version:current.version,kind:'worker'},{
    fetchImpl:async(url,init)=>{
      assert.equal(new URL(url).pathname,'/healthz');
      assert.equal(init.redirect,'error');assert.equal(init.cache,'no-store');
      assert.ok(init.signal instanceof AbortSignal);calls++;
      return health({version:calls===1?oldVersion:current.version});
    },attempts:3,delayMs:10,sleep:async ms=>delays.push(ms),onRetry:notice=>notices.push(notice)
  });
  assert.equal(result.version,current.version);assert.equal(result.status,'verified');
  assert.equal(calls,2);assert.deepEqual(delays,[10]);assert.equal(notices.length,1);
});

test('a persistently wrong version exhausts bounded attempts and fails rather than passing a partial release',async()=>{
  let calls=0;const waits=[];
  await assert.rejects(waitForRelease({api,version:current.version,kind:'worker'},{
    fetchImpl:async()=>{calls++;return health({version:oldVersion});},
    attempts:3,delayMs:5,sleep:async ms=>waits.push(ms)
  }),/后台版本尚未匹配/);
  assert.equal(calls,3);assert.deepEqual(waits,[5,5]);
});

test('a transient gateway503 is retried and all public resources must then match in one complete attempt',async()=>{
  const paths=[];let healthCalls=0;
  const result=await waitForRelease(options,{
    attempts:3,delayMs:0,sleep:async()=>{},fetchImpl:async(url,init)=>{
      const pathname=new URL(url).pathname;paths.push(pathname);
      assert.equal(init.method??'GET','GET');assert.equal(init.redirect,'error');assert.equal(init.cache,'no-store');
      assert.ok(init.signal instanceof AbortSignal);
      if(pathname==='/healthz'&&++healthCalls===1)return new Response('unavailable',{status:503});
      return validResource(url);
    }
  });
  assert.deepEqual(result,{status:'verified',...current});
  assert.deepEqual(paths,['/healthz','/healthz','/version.json','/calendar-reminders/config.json','/calendar-reminders/']);
});

test('a frontend configured for a different API origin can never be reported as verified',async()=>{
  let configCalls=0,htmlCalls=0;
  await assert.rejects(waitForRelease(options,{
    attempts:2,delayMs:0,sleep:async()=>{},fetchImpl:async url=>{
      const pathname=new URL(url).pathname;
      if(pathname==='/calendar-reminders/config.json'){configCalls++;return json({apiBaseUrl:'https://incorrect.workers.dev'});}
      if(pathname==='/calendar-reminders/')htmlCalls++;
      return validResource(url);
    }
  }));
  assert.equal(configCalls,2);assert.equal(htmlCalls,0);
});

test('the overall deadline caps retries and sleep even when more attempts remain',async()=>{
  let time=0,calls=0;const waits=[];
  await assert.rejects(waitForRelease(options,{
    attempts:20,timeoutMs:10,delayMs:8,now:()=>time,
    sleep:async ms=>{waits.push(ms);time+=ms;},
    fetchImpl:async()=>{calls++;time+=3;return new Response(null,{status:503});}
  }),/健康检查必须返回 200/);
  assert.equal(calls,1);assert.deepEqual(waits,[7]);assert.equal(time,10);
});

test('matching commits do not bypass gateway, data, transport or rendered-page integrity checks',async()=>{
  const failures=[
    {path:'/healthz',response:()=>health({gatewayVersion:oldVersion})},
    {path:'/healthz',response:()=>Response.json({status:'ok',...current,gatewayVersion:current.version})},
    {path:'/version.json',response:()=>json({...current,dataVersion:'d'.repeat(64)})},
    {path:'/version.json',response:()=>json({...current,environment:'trial'})},
    {path:'/calendar-reminders/',response:()=>new Response(`<meta content="${oldVersion}">`)}
  ];
  for(const failure of failures){
    await assert.rejects(verifyReleaseOnce(options,{fetchImpl:async url=>new URL(url).pathname===failure.path?failure.response():validResource(url)}));
  }
});

test('a missing stylesheet returning Pages fallback HTML cannot pass release verification',async()=>{
  const resource=style=>async url=>{
    const pathname=new URL(url).pathname;
    if(pathname==='/calendar-reminders/')return new Response(`<meta content="${current.version}"><link rel="stylesheet" href="./motion.css">`);
    if(pathname==='/calendar-reminders/motion.css')return style();
    return validResource(url);
  };
  for(const style of [()=>new Response('<html>Open calendar</html>',{headers:{'Content-Type':'text/html'}}),
    ()=>new Response(null,{status:404}),()=>new Response('',{headers:{'Content-Type':'text/css'}})]){
    await assert.rejects(verifyReleaseOnce(options,{fetchImpl:resource(style)}),/motion.css/);
  }
  const result=await verifyReleaseOnce(options,{fetchImpl:resource(()=>new Response('.primary{opacity:1}',{headers:{'Content-Type':'text/css; charset=utf-8'}}))});
  assert.equal(result.status,'verified');
});
