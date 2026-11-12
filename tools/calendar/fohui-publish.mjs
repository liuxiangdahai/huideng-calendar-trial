// GitHub-only handoff: a data branch is checked by the existing release workflow.
// Only a future extension may fast-forward main, then dispatch that same workflow.
import fs from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const REPO='liuxiangdahai/huideng-calendar-trial';
export function publicationPolicy(report,files){
  const allowed=new Set(['data/calendar/fohui-dates.json','data/calendar/published-record-ids.json','data/calendar/fohui-changes.json','static/calendar-reminders/calendar-data.json',
    ...['tsok','buddha','masters','practice','festivals','nature','other'].map(id=>`static/calendar-reminders/feeds/${id}.ics`),'static/calendar-reminders/feeds/manifest.json']);
  const unexpected=files.filter(file=>!allowed.has(file));
  if(unexpected.length)throw new Error('资料任务不能提交其他文件：'+unexpected.join('、'));
  if(!files.length||!report.after||!/^[a-f\d]{64}$/.test(report.after.factsSha256)||!['ready','review-required'].includes(report.status)||report.changes.some(c=>c.blocking))throw new Error('没有可发布的已校验候选资料。');
  return {automatic:report.automaticEligible===true&&report.status==='ready'&&report.editedDays===0&&report.newDays>0&&report.newDays<=400&&
    report.after.end>report.before.end&&report.changes.every(c=>['added','observance-added','coverage-extended'].includes(c.kind)),
    branch:`automation/fohui-${report.after.factsSha256.slice(0,16)}`};
}

const run=(command,args,input)=>execFileSync(command,args,{encoding:'utf8',input,stdio:['pipe','pipe','pipe'],maxBuffer:2*1024*1024}).trim();
const api=(route,body)=>JSON.parse(run('gh',['api',`repos/${REPO}/${route}`,...(body?['--method','POST','--input','-']:[])],body?JSON.stringify(body):undefined)||'null');
async function dispatchAndWait(ref,sha,{wait=true}={}){
  const since=Date.now()-3000;
  api('actions/workflows/calendar-trial.yml/dispatches',{ref,inputs:{operation:'release'}});
  const deadline=Date.now()+(wait?20*60*1000:2*60*1000);
  while(Date.now()<deadline){
    const data=api(`actions/workflows/calendar-trial.yml/runs?branch=${encodeURIComponent(ref)}&event=workflow_dispatch&per_page=20`);
    const match=data.workflow_runs.find(r=>(!sha||r.head_sha===sha)&&Date.parse(r.created_at)>=since);
    if(match&&(!wait||match.status==='completed')){
      if(wait&&match.conclusion!=='success')throw new Error(`资料检查未通过，保留待核对分支：${match.html_url}`);
      return {id:match.id,url:match.html_url,sha:match.head_sha,status:match.status,conclusion:match.conclusion};
    }
    await delay(15000);
  }
  throw new Error('等候现有发布流程超时，请从 Actions 查看；未绕过检查。');
}

export async function publish({command=run,dispatch=dispatchAndWait,context=process.env,read=fs.readFile,write=fs.writeFile}={}){
  const run=command;
  if(context.GITHUB_REPOSITORY!==REPO||context.GITHUB_REF!=='refs/heads/main'||!context.GITHUB_ACTIONS)throw new Error('自动提交只允许在本仓库 main 的 Actions 中执行。');
  const report=JSON.parse(await read('artifacts/source-maintenance/report.json','utf8'));
  const files=[...run('git',['diff','--name-only']).split('\n'),...run('git',['ls-files','--others','--exclude-standard']).split('\n')].filter(Boolean);
  const policy=publicationPolicy(report,files);
  const base=run('git',['rev-parse','HEAD']);
  const receipt={checkedAt:new Date().toISOString(),base,automatic:policy.automatic,status:'pending'};
  const save=()=>write('artifacts/source-maintenance/publication.json',JSON.stringify(receipt,null,2)+'\n');
  try{
    run('git',['fetch','origin','refs/heads/main:refs/remotes/origin/main']);
    if(run('git',['rev-parse','origin/main'])!==base){receipt.status='base-changed';await save();throw new Error('主分支已有新修改，本次不覆盖，请重新运行资料检查。');}
    receipt.compareUrl=`https://github.com/${REPO}/compare/main...${policy.branch}`;
    if(run('git',['ls-remote','--heads','origin',`refs/heads/${policy.branch}`])){
      receipt.status='existing-review';await save();console.log('相同资料已有候选分支，需核对：'+receipt.compareUrl);return receipt;
    }
    run('git',['switch','-c',policy.branch]);
    run('git',['config','user.name','github-actions[bot]']);
    run('git',['config','user.email','41898282+github-actions[bot]@users.noreply.github.com']);
    run('git',['add','--',...files]);
    run('git',['commit','-m',`Update confirmed Fohui calendar facts (${report.checkedAt.slice(0,10)})`]);
    const commit=run('git',['rev-parse','HEAD']);receipt.commit=commit;
    // No force push: an existing or concurrently modified branch must be reviewed.
    run('git',['push','origin',`HEAD:refs/heads/${policy.branch}`]);
    receipt.status='checking';await save();
    receipt.checks=await dispatch(policy.branch,commit);
    if(!policy.automatic){receipt.status='review-required';await save();return receipt;}
    // A normal fast-forward is atomic with respect to concurrent main edits.
    // A protected branch can reject it; there is no bypass or forced update.
    run('git',['push','origin',`${commit}:refs/heads/main`]);
    receipt.status='committed-awaiting-release';await save();
    // GITHUB_TOKEN pushes do not trigger push workflows. Always explicitly dispatch.
    receipt.release=await dispatch('main',null,{wait:false});
    receipt.status='release-requested';await save();
    console.log(`资料已检查，发布由既有流程继续：${receipt.release.url}`);
    return receipt;
  }catch(error){
    receipt.failure='自动提交或检查未完成；查看本次 Actions 与候选分支，线上资料不得据此标为已更新。';await save();
    // Do not print subprocess stderr, environment or authenticated remotes.
    throw new Error(`${receipt.failure}${error.message.startsWith('资料检查')?error.message:''}`);
  }
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))await publish();
