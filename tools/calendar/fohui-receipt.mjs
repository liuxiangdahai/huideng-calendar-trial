// A small maintenance record remains after Actions artifacts expire. It also
// prevents a healthy, otherwise quiet public repository going 60 days idle.
// Only this one documentation path can be updated; it does not deploy anything.
import fs from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
const repo='liuxiangdahai/huideng-calendar-trial';
if(process.env.GITHUB_REPOSITORY!==repo||process.env.GITHUB_REF!=='refs/heads/main'||!process.env.GITHUB_ACTIONS)throw new Error('仅在本仓库主分支记录自动检查。');
const report=JSON.parse(await fs.readFile('artifacts/source-maintenance/report.json','utf8'));
let publication=null;
try{publication=JSON.parse(await fs.readFile('artifacts/source-maintenance/publication.json','utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
const receipt={schemaVersion:1,checkedAt:report.checkedAt,status:report.status,sourceRange:report.before?[report.before.start,report.before.end]:null,
  candidateEnd:report.after?.end||null,newDays:report.newDays??null,editedDays:report.editedDays??null,
  issues:report.changes?.filter(c=>c.blocking).map(c=>({kind:c.kind,date:c.date||c.from||null}))||[],
  failureCode:report.code||null,robotsAllowed:report.policy?.allowed??null,
  publicationStatus:publication?.status||null,publicationFailure:publication?.failure||null,
  run:`https://github.com/${repo}/actions/runs/${process.env.GITHUB_RUN_ID}`,
  releaseRun:publication?.release?.url||null};
const route=`repos/${repo}/contents/docs/evidence/source-maintenance/latest-check.json`;
const call=(args,input)=>spawnSync('gh',['api',route,...args],{encoding:'utf8',input,stdio:['pipe','pipe','pipe']});
for(let attempt=0;attempt<3;attempt++){
  const current=call([]);let sha;
  if(current.status===0)sha=JSON.parse(current.stdout).sha;
  else if(!current.stderr.includes('HTTP 404'))throw new Error('无法读取维护记录；未覆盖其他文件。');
  const data={message:'Record Fohui source maintenance check [skip ci]',branch:'main',content:Buffer.from(JSON.stringify(receipt,null,2)+'\n').toString('base64'),...(sha?{sha}:{})};
  const result=call(['--method','PUT','--input','-'],JSON.stringify(data));
  if(result.status===0){console.log('已保存资料维护记录。');break;}
  if(attempt===2||!result.stderr.includes('HTTP 409'))throw new Error('维护记录保存失败；请检查 Actions 仓库写权限，勿让定时任务长期无人核对。');
}
