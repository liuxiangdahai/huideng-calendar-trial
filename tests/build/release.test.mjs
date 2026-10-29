import {test} from 'node:test';
import assert from 'node:assert/strict';
import {resolveBuildOptions,isPublicFile,assertReleaseInputs,buildStandalone,buildRelease,projectRoot,resolveDeploymentConfig,pagesConfiguration} from '../../tools/calendar/release-build.mjs';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {Script} from 'node:vm';

test('standalone embeds literal dollar sequences without restoring external scripts or corrupting JavaScript',async()=>{
 const artifacts=path.resolve(projectRoot,'artifacts');mkdirSync(artifacts,{recursive:true});
 const fixture=mkdtempSync(path.join(artifacts,'standalone-build-'));
 const output=path.join(fixture,'calendar.html');
 // JSON payloads and generated JS may contain replacement metacharacters. In
 // particular esbuild can produce `$&&` when its short variable name is `$`.
 const config={apiBaseUrl:'',literal:"$$ | $& | $` | $' | </script>"};
 try{
  await buildStandalone({output,config});
  const html=readFileSync(output,'utf8');
  const embedded=html.match(/<script id="calendar-inline-config" type="application\/json">([\s\S]*?)<\/script>/);
  assert.ok(embedded,'embedded configuration exists');
  assert.deepEqual(JSON.parse(embedded[1]),config);
  const scripts=[...html.matchAll(/<script type="module">([\s\S]*?)<\/script>/g)];
  assert.equal(scripts.length,1);
  assert.doesNotThrow(()=>new Script(scripts[0][1]));
  assert.doesNotMatch(html,/<script[^>]*\bsrc=/);
  assert.doesNotMatch(html,/\b(?:src|href)="\.\/|url\(['"]?\.\/assets\//);
 }finally{
  const safe=path.resolve(fixture);assert.ok(safe.startsWith(artifacts+path.sep));
  rmSync(safe,{recursive:true,force:true});
 }
});

test('a release rejects regenerated date changes, untracked inputs and a stale commit stamp',()=>{
 const fixture=mkdtempSync(path.join(tmpdir(),'calendar-release-'));
 const git=(...args)=>execFileSync('git',args,{cwd:fixture,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
 try{
  mkdirSync(path.join(fixture,'static/calendar-reminders'),{recursive:true});
  const data=path.join(fixture,'static/calendar-reminders/calendar-data.json');
  writeFileSync(data,'{"version":1}\n');git('init','--quiet');git('add','.');
  const commit=()=>git('-c','user.name=Build Test','-c','user.email=build@example.invalid','commit','--quiet','-m','fixture');commit();
  const old=git('rev-parse','HEAD');assert.doesNotThrow(()=>assertReleaseInputs(old,fixture));
  writeFileSync(data,'{"version":2}\n');assert.throws(()=>assertReleaseInputs(old,fixture),/生成日期资料/);
  git('add','.');commit();const current=git('rev-parse','HEAD');
  assert.throws(()=>assertReleaseInputs(old,fixture));assert.doesNotThrow(()=>assertReleaseInputs(current,fixture));
  writeFileSync(path.join(fixture,'static/calendar-reminders/new-module.mjs'),'export const version=2;');
  assert.throws(()=>assertReleaseInputs(current,fixture));
 }finally{
  const safe=path.resolve(fixture);assert.ok(safe.startsWith(path.resolve(tmpdir())+path.sep));
  rmSync(safe,{recursive:true,force:true});
 }
});
test('remote builds require HTTPS origins and an exact commit; offline mode never inherits API configuration',()=>{
 const version='a'.repeat(40);
 const valid={mode:'trial',apiBaseUrl:'https://calendar.pages.dev',siteOrigin:'https://calendar.pages.dev',version};
 assert.equal(resolveBuildOptions(valid,{}).remote,true);
 for(const apiBaseUrl of ['http://calendar.workers.dev','https://user:secret@calendar.workers.dev','https://calendar.workers.dev/path','https://localhost'])assert.throws(()=>resolveBuildOptions({...valid,apiBaseUrl},{}));
 assert.throws(()=>resolveBuildOptions({...valid,version:'unknown'},{}));
 assert.throws(()=>resolveBuildOptions({...valid,output:'../'},{}));
 assert.throws(()=>resolveBuildOptions({...valid,apiBaseUrl:'https://calendar.workers.dev'},{}));
 assert.equal(resolveBuildOptions({mode:'offline'},{CALENDAR_API_BASE_URL:valid.apiBaseUrl}).apiBaseUrl,'');
});

test('environment configuration isolates all public and private resources and leaves Pages previews unbound',()=>{
 const configuration=Object.fromEntries(['acceptance','trial'].map((mode,i)=>[mode,{
  siteOrigin:`https://huideng-calendar-${mode}.pages.dev`,publicApiOrigin:`https://huideng-calendar-${mode}.pages.dev`,
  workerOrigin:`https://huideng-calendar-${mode}.account.workers.dev`,pagesProjectName:`huideng-calendar-${mode}`,
  workerName:`huideng-calendar-${mode}`,databaseName:`huideng-calendar-${mode}`,databaseId:`${i+1}0000000-0000-0000-0000-000000000000`
 }]));
 const target=resolveDeploymentConfig(configuration,'acceptance');
 const config=pagesConfiguration(target);
 assert.deepEqual(config.services,[]);assert.deepEqual(config.env.preview.services,[]);
 assert.deepEqual(config.env.production.services,[{binding:'CALENDAR_SERVICE',service:target.workerName}]);
 assert.equal(config.env.production.vars.PUBLIC_BASE_URL,target.siteOrigin);
 for(const [key,value] of [['workerName',configuration.trial.workerName],['databaseId',configuration.trial.databaseId],
   ['siteOrigin',configuration.trial.siteOrigin],['publicApiOrigin',configuration.acceptance.workerOrigin],
   ['workerOrigin',configuration.trial.workerOrigin],['pagesProjectName',configuration.trial.pagesProjectName],
   ['allowedOrigins',[configuration.trial.siteOrigin]]]){
  const invalid=structuredClone(configuration);invalid.acceptance[key]=value;
  assert.throws(()=>resolveDeploymentConfig(invalid,'acceptance'),key);
 }
});

test('remote builds cannot silently publish a static-only site without its gateway configuration',async()=>{
 await assert.rejects(buildRelease({mode:'acceptance',apiBaseUrl:'https://huideng-calendar-acceptance.pages.dev',
  siteOrigin:'https://huideng-calendar-acceptance.pages.dev',version:'a'.repeat(40)},{}),/build-environment/);
});

test('uncommitted gateway code prevents stamped remote release',()=>{
 const fixture=mkdtempSync(path.join(tmpdir(),'calendar-gateway-release-'));
 const git=(...args)=>execFileSync('git',args,{cwd:fixture,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
 try{
  mkdirSync(path.join(fixture,'service/gateway'),{recursive:true});
  writeFileSync(path.join(fixture,'service/gateway/worker.mjs'),'export default {};');
  git('init','--quiet');git('add','.');git('-c','user.name=Build Test','-c','user.email=build@example.invalid','commit','--quiet','-m','fixture');
  const version=git('rev-parse','HEAD');assert.doesNotThrow(()=>assertReleaseInputs(version,fixture));
  writeFileSync(path.join(fixture,'service/gateway/worker.mjs'),'export default {fetch(){}};');
  assert.throws(()=>assertReleaseInputs(version,fixture));
 }finally{assert.ok(path.resolve(fixture).startsWith(path.resolve(tmpdir())+path.sep));rmSync(fixture,{recursive:true,force:true});}
});
test('Pages publishes only approved public assets and cannot expose backend, config secrets or databases',()=>{
 for(const file of ['index.html','version.json','_worker.js','_routes.json','calendar-reminders/index.html','calendar-reminders/app-ABC123.js','calendar-reminders/assets/huideng-logo.png','calendar-reminders/licenses/zangli-LICENSE.txt'])assert.equal(isPublicFile(file),true,file);
 for(const file of ['worker/worker.mjs','.env','deployment.local.json','_worker.js.map','_worker.js/wrangler.json','calendar-reminders/assets/.env','calendar-reminders/service.sqlite','calendar-reminders/app.mjs'])assert.equal(isPublicFile(file),false,file);
});
