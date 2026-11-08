import assert from 'node:assert/strict';
import {setTimeout as sleepDefault} from 'node:timers/promises';

// Deploy commands can finish before every read observes the new version.
// Retry read-only verification as a whole; never accept a partially matched release.
export async function verifyReleaseOnce({api,site,version,kind='gateway'},
  {fetchImpl=fetch,timeoutMs=20000,now=Date.now}={}) {
  assert.ok(['worker','gateway'].includes(kind),'无效的版本检查类型');
  const deadline=now()+timeoutMs;
  const read=async(origin,path)=>{
    const remaining=deadline-now();
    assert.ok(remaining>0,'版本检查超时');
    const response=await fetchImpl(new URL(path,origin),{cache:'no-store',redirect:'error',signal:AbortSignal.timeout(Math.max(1,Math.min(20000,Math.floor(remaining))))});
    if(response.status!==200)await response.body?.cancel();
    return response;
  };
  const health=await read(api,'/healthz');
  assert.equal(health.status,200,'健康检查必须返回 200');
  const backend=await health.json();
  assert.equal(backend.status,'ok');
  if(version)assert.equal(backend.version,version,'后台版本尚未匹配');
  if(kind==='gateway')assert.equal(backend.gatewayVersion,backend.version,'网关与后台版本不匹配');
  assert.ok(health.headers.get('strict-transport-security'),'HTTPS必须包含传输保护');
  if(site){
    const response=await read(site,'/version.json');
    assert.equal(response.status,200);
    const frontend=await response.json();
    for(const key of ['version','dataVersion','environment'])assert.equal(frontend[key],backend[key],`前后端 ${key} 不匹配`);
    const configResponse=await read(site,'/calendar-reminders/config.json');
    assert.equal(configResponse.status,200);
    const config=await configResponse.json();
    assert.equal(config.apiBaseUrl,new URL(api).origin);
    assert.equal(config.apiBaseUrl,new URL(site).origin,'页面必须使用同源 API');
    const htmlResponse=await read(site,'/calendar-reminders/');
    assert.equal(htmlResponse.status,200);
    const html=await htmlResponse.text();
    assert.ok(html.includes(`content="${backend.version}"`));
  }
  assert.ok(now()<=deadline,'版本检查超时');
  return {status:'verified',version:backend.version,dataVersion:backend.dataVersion,environment:backend.environment};
}

export async function waitForRelease(options,{fetchImpl=fetch,attempts=8,delayMs=3000,
  timeoutMs=60000,sleep=sleepDefault,onRetry=()=>{},now=Date.now}={}) {
  assert.ok(Number.isInteger(attempts)&&attempts>0&&attempts<=20);
  assert.ok(timeoutMs>0&&delayMs>=0);
  new URL(options.api); if(options.site)new URL(options.site);
  const deadline=now()+timeoutMs;
  let failure;
  for(let attempt=1;attempt<=attempts;attempt++){
    const remaining=deadline-now();
    if(remaining<=0)break;
    try{return await verifyReleaseOnce(options,{fetchImpl,timeoutMs:remaining,now});}
    catch(error){failure=error;}
    if(attempt===attempts||now()>=deadline)break;
    onRetry({status:'waiting-for-release',attempt});
    await sleep(Math.min(delayMs,Math.max(0,deadline-now())));
  }
  throw failure||new Error('版本检查超时');
}
