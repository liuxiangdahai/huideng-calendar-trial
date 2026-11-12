// Collect public calendar facts, record changes, and stage a validated candidate.
// No credentials are sent to the source. No source HTML or scripts are executed.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createSourceClient, SourceFailure} from './fohui-fetch.mjs';
import {readSourceState,collectMonths,prepareUpdate,applyCandidate} from './fohui-maintenance-core.mjs';

const args=process.argv.slice(2);
const value=(name,fallback)=>args.includes(name)?args[args.indexOf(name)+1]:fallback;
if(args.some((a,i)=>!['--apply','--output'].includes(a)&&args[i-1]!=='--output'))throw new Error('用法：fohui-maintain.mjs [--apply] [--output 目录]');
const output=path.resolve(value('--output','artifacts/source-maintenance'));
await fs.mkdir(output,{recursive:true});
// Old artifacts are not evidence for a new run, even after an interrupted check.
for(const file of ['report.json','observations.json','candidate.json','publication.json','robots.txt'])await fs.rm(path.join(output,file),{force:true});
const save=(file,data)=>fs.writeFile(path.join(output,file),JSON.stringify(data,null,2)+'\n');
const now=new Date(),config=JSON.parse(await fs.readFile('data/calendar/source-maintenance.json','utf8'));
if(config.schemaVersion!==1||config.minimumIntervalMs!==5000||config.automaticPublication!=='known-future-extension-only'||config.maxExtensionDays!==400)throw new Error('来源维护配置不符合已审计的范围。');
let cache={};
try{cache=JSON.parse(await fs.readFile(path.join(output,'cache.json'),'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
const client=createSourceClient({cache,publicReadAuthorized:config.publicReadAuthorized===true});
try{
  const state=await readSourceState();
  const collection=await collectMonths(client,state.existing,now,entry=>console.log(`${entry.month}：${entry.days}天（${entry.state}）`));
  const {report,candidate}=prepareUpdate(state,collection,{now,maxExtensionDays:config.maxExtensionDays});
  await save('report.json',report);
  await save('observations.json',{checkedAt:now.toISOString(),days:collection.incoming,snapshots:collection.snapshots});
  await save('cache.json',client.cache);
  await fs.writeFile(path.join(output,'robots.txt'),collection.policy.body);
  if(candidate)await save('candidate.json',candidate);
  if(args.includes('--apply')&&candidate)await applyCandidate(candidate);
  if(process.env.GITHUB_OUTPUT)await fs.appendFile(process.env.GITHUB_OUTPUT,`status=${report.status}\ncandidate=${!!candidate}\nautomatic=${report.automaticEligible}\n`);
  console.log(`来源检查：${report.status}；检查${collection.observations.length}个月；新增${report.newDays}天，修订${report.editedDays}天，变更${report.changes.length}项。`);
  if(report.status==='review-required'&&!candidate)process.exitCode=2;
}catch(error){
  const report={schemaVersion:1,checkedAt:now.toISOString(),status:'failed',code:error instanceof SourceFailure?error.code:'validation-failed',message:error.message,requests:client.requests,policy:client.policyObservation?{...client.policyObservation,body:undefined}:null};
  if(client.policyObservation)await fs.writeFile(path.join(output,'robots.txt'),client.policyObservation.body);
  await save('report.json',report);
  console.error(report.message);process.exitCode=1;
}
