// Incident recovery only, not an alternative release path. These identifiers come
// from the successful trial job 127166977225 in Actions run 42003059089.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs/promises';
import {waitForRelease} from './verify-release-core.mjs';

const stable='23abc3e39af655278de05233defcd8f92477b41a';
const interrupted='d9e96fce26646b8dc38f1f4084025c952ee8b5cd';
const versionId='5daec4d6-d837-416d-b51e-2f916bbd1999';
const site='https://huideng-calendar-trial.pages.dev';
const worker='https://huideng-calendar-trial.huideng-liuxiangdahai.workers.dev';
const evidence={checkedAt:new Date().toISOString(),stable,interrupted,versionId,site,status:'checking'};
const read=async(url)=>{
  const r=await fetch(url,{redirect:'error',cache:'no-store',signal:AbortSignal.timeout(15000)});
  assert.equal(r.status,200,'恢复前读取失败，未执行回滚');
  return r.json();
};
try {
  assert.equal(process.env.GITHUB_EVENT_NAME,'workflow_dispatch','仅允许明确启动的恢复作业');
  assert.equal(process.env.GITHUB_REF,'refs/heads/main');
  assert.ok(process.env.CLOUDFLARE_API_TOKEN&&process.env.CLOUDFLARE_ACCOUNT_ID);
  // Runtime, migrations, source dates and event identity must be unchanged.
  execFileSync('git',['diff','--exit-code',stable,interrupted,'--','service','data','vendor',
    'static/calendar-reminders/core.mjs','static/calendar-reminders/engine.mjs',
    'static/calendar-reminders/timezones.mjs'],{stdio:'pipe'});
  const page=await read(`${site}/version.json`),backend=await read(`${worker}/healthz`);
  assert.equal(page.version,stable,'现有页面已变化，停止恢复');
  assert.ok([interrupted,stable].includes(backend.version),'后台已变化，停止恢复');
  assert.equal(page.environment,'trial');assert.equal(backend.environment,'trial');
  assert.equal(page.dataVersion,backend.dataVersion);
  evidence.before={pageVersion:page.version,workerVersion:backend.version,dataVersion:page.dataVersion};
  if(backend.version!==stable){
    execFileSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','rollback',versionId,
      '--name','huideng-calendar-trial','--yes','--message',
      'Restore verified 23abc3e Worker to match existing trial Pages after interrupted release; preserve D1'],
      {stdio:'inherit',timeout:60000});
  }
  evidence.after=await waitForRelease({api:site,site,version:stable},{onRetry:()=>console.log('等待恢复版本一致')});
  evidence.status='verified';
  console.log(JSON.stringify(evidence));
} catch(error){
  evidence.status='failed';
  // Do not serialize CLI errors, which can include environment or request data.
  evidence.error='恢复或恢复后验证未完成，需检查作业日志；不得认定已恢复';
  throw error;
} finally {
  await fs.mkdir('artifacts',{recursive:true});
  await fs.writeFile('artifacts/trial-recovery.json',JSON.stringify(evidence,null,2));
}
