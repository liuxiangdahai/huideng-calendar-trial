import assert from 'node:assert/strict';
const [api,site,version,kind='gateway']=process.argv.slice(2);
const health=await fetch(new URL('/healthz',api),{redirect:'error',signal:AbortSignal.timeout(20000)});
assert.equal(health.status,200,'健康检查必须返回 200');
const backend=await health.json();
assert.equal(backend.status,'ok');
if(version)assert.equal(backend.version,version);
if(kind==='gateway')assert.equal(backend.gatewayVersion,backend.version,'网关与后台版本不匹配');
assert.ok(health.headers.get('strict-transport-security'),'HTTPS必须包含传输保护');
if(site){
 const response=await fetch(new URL('/version.json',site),{cache:'no-store',signal:AbortSignal.timeout(20000)});
 assert.equal(response.status,200);
 const frontend=await response.json();
 for(const key of ['version','dataVersion','environment'])assert.equal(frontend[key],backend[key],`前后端 ${key} 不匹配`);
 const config=await (await fetch(new URL('/calendar-reminders/config.json',site))).json();
 assert.equal(config.apiBaseUrl,new URL(api).origin);
 assert.equal(config.apiBaseUrl,new URL(site).origin,'页面必须使用同源 API');
 const html=await (await fetch(new URL('/calendar-reminders/',site))).text();
 assert.ok(html.includes(`content="${backend.version}"`));
}
console.log(JSON.stringify({status:'verified',version:backend.version,dataVersion:backend.dataVersion,environment:backend.environment}));
