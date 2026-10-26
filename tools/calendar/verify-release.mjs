import assert from 'node:assert/strict';
const [api,site,version]=process.argv.slice(2);
const health=await fetch(new URL('/healthz',api),{signal:AbortSignal.timeout(20000)});
assert.equal(health.status,200,'健康检查必须返回 200');
const backend=await health.json();
assert.equal(backend.status,'ok');
if(version)assert.equal(backend.version,version);
if(site){
 const response=await fetch(new URL('/version.json',site),{cache:'no-store',signal:AbortSignal.timeout(20000)});
 assert.equal(response.status,200);
 const frontend=await response.json();
 for(const key of ['version','dataVersion','environment'])assert.equal(frontend[key],backend[key],`前后端 ${key} 不匹配`);
 const config=await (await fetch(new URL('/calendar-reminders/config.json',site))).json();
 assert.equal(config.apiBaseUrl,new URL(api).origin);
 const html=await (await fetch(new URL('/calendar-reminders/',site))).text();
 assert.ok(html.includes(`content="${backend.version}"`));
}
console.log(JSON.stringify({status:'verified',version:backend.version,dataVersion:backend.dataVersion,environment:backend.environment}));
