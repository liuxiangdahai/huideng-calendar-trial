// Read-only account probes. Credentials and raw API responses never enter evidence.
// Sources: Cloudflare API (Worker script-settings, D1 database, Pages project),
// https://developers.cloudflare.com/analytics/graphql-api/tutorials/querying-workers-metrics/
// https://developers.cloudflare.com/analytics/graphql-api/features/discovery/introspection/
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../../',import.meta.url));
const API='https://api.cloudflare.com/client/v4';
const numeric=value=>typeof value==='number' && Number.isFinite(value) && value>=0 ? value : null;
class ProbeError extends Error {
 constructor(code,message,status=null){super(message);this.code=code;this.status=status;}
}
const failure=(code,message,status)=>new ProbeError(code,message,status);
function options(args){
 const result={preflight:false,output:'artifacts/cloudflare-metrics.json'};
 for(let i=0;i<args.length;i++){
  if(args[i]==='--preflight')result.preflight=true;
  else if(['--smoke-report','--output'].includes(args[i]) && args[i+1] && !args[i+1].startsWith('--'))result[args[i].slice(2)]=args[++i];
  else throw failure('invalid_arguments','请使用 --preflight 或 --smoke-report artifacts/remote-smoke.json。');
 }
 if(result.preflight===Boolean(result['smoke-report']))throw failure('invalid_arguments','必须且只能选择一种检查模式。');
 const output=path.resolve(root,result.output),relative=path.relative(path.join(root,'artifacts'),output);
 if(!relative || relative.startsWith('..') || path.isAbsolute(relative))throw failure('invalid_output','诊断结果必须写入项目 artifacts 目录。');
 return {...result,output};
}
async function request(token,pathname,body){
 let response,data;
 try{
  response=await fetch(API+pathname,{method:body?'POST':'GET',redirect:'error',
   headers:{Authorization:`Bearer ${token}`,Accept:'application/json',...(body?{'Content-Type':'application/json'}:{})},
   body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(30000)});
  data=await response.json();
 }catch{throw failure('network_or_response','Cloudflare 请求未完成或返回格式无效；请检查网络后重试。');}
 if(!response.ok || data.success===false || data.errors?.length){
  const denied=[401,403].includes(response.status) || data.errors?.some(error=>
   /not authorized|permission|authentication|unauthorized|forbidden/i.test(String(error?.message||'')));
  throw failure(denied?'access_denied':'cloudflare_rejected',denied?
   'Cloudflare 拒绝访问；请检查令牌权限、账户范围及有效期。':
   'Cloudflare 未接受诊断请求；需要核对资源、查询支持情况和服务状态。',response.status);
 }
 return data;
}
async function graphql(token,query,variables={}){return (await request(token,'/graphql',{query,variables})).data;}

// Unit conversion depends on the live schema, not an assumption about API units.
export function cpuSchema(fields=[]){
 const available=new Map(fields.map(field=>[field.name,String(field.description||'')]));
 const names=['cpuTimeP50',...(available.has('cpuTimeP95')?['cpuTimeP95']:[]),'cpuTimeP99'];
 const units=names.map(name=>{
  const text=available.get(name)||'';
  return /microseconds|microsecond|µs|μs/i.test(text)?'microseconds':/milliseconds|millisecond/i.test(text)?'milliseconds':null;
 });
 const unit=units.every(value=>value && value===units[0])?units[0]:'unknown';
 return {names,unit};
}
export function summarizeMetrics(data,schema,hasSampling){
 const accounts=data?.viewer?.accounts;
 if(!Array.isArray(accounts)||accounts.length!==1)throw failure('account_unavailable','Analytics 未返回指定账户，不能判定权限已通过。');
 const rows=accounts[0].overall, outcomes=accounts[0].outcomes;
 if(!Array.isArray(rows)||!Array.isArray(outcomes))throw failure('invalid_metrics','Analytics 返回结构不符合预期。');
 if(rows.length>1)throw failure('invalid_metrics','整体指标出现多组结果，不能平均各组百分位数。');
 const row=rows[0];
 const requests=numeric(row?.sum?.requests), errors=numeric(row?.sum?.errors);
 const raw={p50:numeric(row?.quantiles?.cpuTimeP50),p95:schema.names.includes('cpuTimeP95')?numeric(row?.quantiles?.cpuTimeP95):null,p99:numeric(row?.quantiles?.cpuTimeP99)};
 const ms=schema.unit==='unknown'?null:Object.fromEntries(Object.entries(raw).map(([key,value])=>[key,value===null?null:value/(schema.unit==='microseconds'?1000:1)]));
 const allowed=new Set(['success','exception','exceededCpu','exceededMemory','canceled','unknown','internalError']);
 return {
  status:requests>0?'available':'data_pending',requests,errors,subrequests:numeric(row?.sum?.subrequests),
  cpu:{sourceUnit:schema.unit,raw,milliseconds:ms,p95Available:schema.names.includes('cpuTimeP95'),unitVerified:schema.unit!=='unknown'},
  sampling:{dataset:'workersInvocationsAdaptive',adaptive:true,averageSampleInterval:hasSampling?numeric(row?.avg?.sampleInterval):null,
   rawSampleCount:null,note:'请求数可能为自适应采样估计；平均采样间隔不能用于还原精确原始样本数。'},
  outcomes:outcomes.map(entry=>({status:allowed.has(entry.dimensions?.status)?entry.dimensions.status:'other',requests:numeric(entry.sum?.requests),errors:numeric(entry.sum?.errors)})),
  performanceAcceptance:'pending',
  note:'这是隔离服务时间窗口的汇总。未按冷生成、快照命中或修改分别分组；不代表逐请求 CPU 或免费额度已通过。无数据也不能视为零耗时。'
 };
}
async function metrics(token,account,target,window){
 const introspection=await graphql(token,`query CalendarMetricSchema {
  quantiles: __type(name:"AccountWorkersInvocationsAdaptiveQuantiles") { fields { name description } }
  averages: __type(name:"AccountWorkersInvocationsAdaptiveAvg") { fields { name } }
 }`);
 const schema=cpuSchema(introspection?.quantiles?.fields||[]);
 const hasSampling=Boolean(introspection?.averages?.fields?.some(field=>field.name==='sampleInterval'));
 const filter='filter:{scriptName:$scriptName,datetime_geq:$start,datetime_leq:$end}';
 const data=await graphql(token,`query CalendarMetrics($accountTag:string!,$scriptName:string!,$start:Time!,$end:Time!) {
  viewer { accounts(filter:{accountTag:$accountTag}) {
   overall: workersInvocationsAdaptive(limit:1,${filter}) {
    sum { requests errors subrequests } quantiles { ${schema.names.join(' ')} } ${hasSampling?'avg { sampleInterval }':''}
   }
   outcomes: workersInvocationsAdaptive(limit:100,${filter}) { dimensions { status } sum { requests errors } }
  } }
 }`,{accountTag:account,scriptName:target.workerName,start:window.start,end:window.end});
 return summarizeMetrics(data,schema,hasSampling);
}

export async function run(args=process.argv.slice(2),env=process.env){
 const opt=options(args);
 const report={schemaVersion:1,checkedAt:new Date().toISOString(),mode:opt.preflight?'preflight':'metrics',environment:'acceptance',
  status:'running',probes:[],analytics:null,releaseAcceptance:'pending',
  note:'只读预检证明读取权限与资源可达，不能证明写权限、正式部署、费用或真实手机通知通过。'};
 try{
  const token=env.CLOUDFLARE_API_TOKEN,account=env.CLOUDFLARE_ACCOUNT_ID;
  if(!token || !/^[a-f0-9]{32}$/i.test(account||''))throw failure('missing_credentials','缺少 CLOUDFLARE_API_TOKEN 或有效的 CLOUDFLARE_ACCOUNT_ID。');
  let config;try{config=JSON.parse(await fs.readFile(path.join(root,'deployment.local.json'),'utf8'));}catch{throw failure('missing_config','无法读取部署配置。');}
  const target=config.acceptance,trial=config.trial;
  if(target?.workerName!=='huideng-calendar-acceptance'||!trial||target.databaseId===trial.databaseId||target.workerName===trial.workerName||!/^[a-f0-9-]{36}$/i.test(target.databaseId||''))throw failure('invalid_config','隔离资源配置无效。');
  const probes=[['worker',`/accounts/${account}/workers/scripts/${target.workerName}/script-settings`],
   ['database',`/accounts/${account}/d1/database/${target.databaseId}`],
   ['pages',`/accounts/${account}/pages/projects/huideng-calendar-trial`]];
  for(const [kind,url] of probes){
   try{await request(token,url);report.probes.push({kind,status:'passed'});}
   catch(error){report.probes.push({kind,status:'failed'});throw error;}
  }
  if(opt.preflight){
   const end=new Date();report.window={start:new Date(end.getTime()-1800000).toISOString(),end:end.toISOString(),purpose:'permission_probe_only'};
  }else{
   let smoke;try{smoke=JSON.parse(await fs.readFile(path.resolve(root,opt['smoke-report']),'utf8'));}catch{throw failure('missing_smoke_report','无法读取隔离联调报告。');}
   const start=Date.parse(smoke.startedAt),end=Date.parse(smoke.finishedAt);
   if(!Number.isFinite(start)||!Number.isFinite(end)||start>=end||end-start>86400000||!Array.isArray(smoke.timing)||!/^[a-f0-9]{40}$/.test(smoke.version||''))throw failure('invalid_smoke_report','联调报告必须包含有效 startedAt、finishedAt、version 和 timing。');
   report.version=smoke.version;report.window={start:new Date(start).toISOString(),end:new Date(end).toISOString(),purpose:'isolated_smoke_window'};
   report.clientRecordedRequests=smoke.timing.length;
  }
  report.analytics=await metrics(token,account,target,report.window);
  report.status=opt.preflight?'read_access_verified':report.analytics.status==='available'?'measured':'data_pending';
 }catch(error){
  report.status='failed';report.failure=error instanceof ProbeError?{code:error.code,message:error.message,httpStatus:error.status}:{code:'unexpected',message:'诊断未完成；原始错误不输出，以保护凭证和资源信息。'};
 }finally{
  await fs.mkdir(path.dirname(opt.output),{recursive:true});await fs.writeFile(opt.output,JSON.stringify(report,null,2)+'\n');
 }
 console.log(JSON.stringify({status:report.status,mode:report.mode,probes:report.probes,analytics:report.analytics?.status||null,failure:report.failure||null,releaseAcceptance:'pending'}));
 return report.status==='failed'?1:0;
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{process.exitCode=await run();}catch(error){console.error(error instanceof ProbeError?error.message:'诊断脚本未能完成。');process.exitCode=1;}
}
