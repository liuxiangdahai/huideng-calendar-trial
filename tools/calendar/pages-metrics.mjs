// Discover the Pages dataset from the live schema; never infer CPU units or
// add independently sampled percentiles to obtain an end-to-end percentile.
// Pages rows can be wrapped as [Row!]!: unwrap all three GraphQL containers.
const ref = 'name kind ofType { name kind ofType { name kind ofType { name kind ofType { name kind } } } }';
const leaf = value => value?.name || (value?.ofType && leaf(value.ofType));
export async function pagesMetrics(query, account, project, window, summarize, cpuSchema) {
 const pending = reason => ({status:'pending',reason,performanceAcceptance:'pending'});
 const accountSchema = await query(`{ __type(name:"Account") { fields { name type { ${ref} } args { name type { ${ref} } } } } }`);
 const dataset = accountSchema?.__type?.fields?.find(f=>f.name==='pagesFunctionsInvocationsAdaptiveGroups');
 if(!dataset)return pending('账号未提供Pages指标数据集，不能用Worker指标替代。');
 const rowType=leaf(dataset.type), filterType=leaf(dataset.args?.find(a=>a.name==='filter')?.type);
 if(!rowType||!filterType)return pending('无法确认Pages指标结构。');
 const shape=await query(`{ row:__type(name:${JSON.stringify(rowType)}) { fields { name type { ${ref} } } } filter:__type(name:${JSON.stringify(filterType)}) { inputFields { name } } }`);
 const filterNames=new Set(shape?.filter?.inputFields?.map(f=>f.name));
 const projectField=filterNames.has('scriptName')?'scriptName':filterNames.has('projectName')?'projectName':filterNames.has('projectId')?'projectId':null;
 const fieldType=name=>leaf(shape?.row?.fields?.find(f=>f.name===name)?.type);
 if(!projectField||!filterNames.has('datetime_geq')||!filterNames.has('datetime_leq')||!fieldType('quantiles')||!fieldType('sum'))return pending('缺少可验证的Pages项目或时间过滤字段。');
 const stats=await query(`{ q:__type(name:${JSON.stringify(fieldType('quantiles'))}) { fields { name description } } s:__type(name:${JSON.stringify(fieldType('sum'))}) { fields { name } } }`);
 const schema=cpuSchema(stats?.q?.fields||[]), sumFields=['requests','errors','subrequests'].filter(name=>stats?.s?.fields?.some(f=>f.name===name));
 if(!sumFields.includes('requests')||!schema.names.every(name=>stats?.q?.fields?.some(f=>f.name===name)))return pending('Pages缺少请求数或可核实的CPU分位字段。');
 // A Pages project name is not its generated Functions script name. The Pages
 // API exposes production_script_name separately from name and the preview
 // script; never guess it or mix preview invocations into production evidence.
 // https://developers.cloudflare.com/api/resources/pages/subresources/projects/methods/list/
 const projectValue=projectField==='scriptName'?project?.production_script_name:
  projectField==='projectId'?project?.id:project?.name;
 if(typeof projectValue!=='string'||!projectValue.trim())return pending('无法确认Pages指标项目标识。');
 const filter=`{${projectField}:${JSON.stringify(projectValue)},datetime_geq:${JSON.stringify(window.start)},datetime_leq:${JSON.stringify(window.end)}}`;
 const result=await query(`{viewer{accounts(filter:{accountTag:${JSON.stringify(account)}}){overall:${dataset.name}(limit:1,filter:${filter}){sum{${sumFields.join(' ')}} quantiles{${schema.names.join(' ')}}}}}`);
 for(const entry of result?.viewer?.accounts||[])entry.outcomes=[];
 const report=summarize(result,schema,false);
 report.sampling.dataset=dataset.name;
 report.note='Pages入口单独采样；不能与后台CPU百分位相加。请求及CPU为空时仍待验收。';
 return report;
}
