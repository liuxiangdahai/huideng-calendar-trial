import fs from 'node:fs/promises';
const labels={unchanged:'原历内容没有变化；没有改写资料或发布。',ready:'已获得仅包含未来新增日期的候选资料。','review-required':'有需要维护者核对的变更；未自动发布。',failed:'本次检测失败；保留上一份有效资料。'};
let text='## 佛慧法语资料检查\n\n';
try{
  const r=JSON.parse(await fs.readFile('artifacts/source-maintenance/report.json','utf8'));
  text+=(labels[r.status]||'检查状态需核对。')+'\n\n';
  if(r.before)text+=`现行确认范围：${r.before.start} 至 ${r.before.end}。新增 ${r.newDays} 天，修订 ${r.editedDays} 天。\n\n`;
  if(r.code)text+=`失败分类：\`${r.code.replace(/[^a-z-]/g,'')}\`。\n\n`;
  text+='来源摘要、月份状态和完整差异见本次运行的 source-maintenance 附件。\n\n';
  if(r.policy?.allowed===false)text+='本次 robots 规则仍禁止该路径；按2026年11月9日项目负责人明确的公开读取决定执行。这不是站方授权。\n\n';
  try{
    const p=JSON.parse(await fs.readFile('artifacts/source-maintenance/publication.json','utf8'));
    if(p.prUrl)text+=`候选资料：[查看 PR](${p.prUrl})。\n\n`;
    if(p.release)text+=`已交给[既有发布流程](${p.release.url})；应以该流程和两站版本核验结果判定是否上线。\n\n`;
    if(p.failure)text+='自动提交或发布交接未完成，需检查本次运行和候选 PR。\n\n';
  }catch(error){if(error.code!=='ENOENT')throw error;}
}catch(error){text+='没有完整检查报告，请查看失败步骤；不得推断资料已更新。\n';}
if(process.env.GITHUB_STEP_SUMMARY)await fs.appendFile(process.env.GITHUB_STEP_SUMMARY,text);
console.log(text);
