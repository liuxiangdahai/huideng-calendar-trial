import test from 'node:test';
import assert from 'node:assert/strict';
import {pagesMetrics} from '../../tools/calendar/pages-metrics.mjs';
import {cpuSchema,summarizeMetrics} from '../../tools/calendar/cloudflare-metrics.mjs';

const project={id:'test-project-id',name:'huideng-calendar-acceptance',
 production_script_name:'pages-worker--1234567-production',preview_script_name:'pages-worker--1234567-preview'};
const window={start:'2026-10-29T01:00:00.000Z',end:'2026-10-29T02:00:00.000Z'};
const names=['cpuTimeP50','cpuTimeP95','cpuTimeP99'];
const wrapped=name=>({name:null,kind:'NON_NULL',ofType:{name:null,kind:'LIST',ofType:{name:null,kind:'NON_NULL',ofType:{name,kind:'OBJECT'}}}});
function fixture({dataset=true,filters=['scriptName','datetime_geq','datetime_leq'],
 fields=names.map(name=>({name,description:'CPU time percentile - microseconds'})),
 sums=['requests','errors','subrequests'],rows=[{sum:{requests:20,errors:0,subrequests:20},
 quantiles:{cpuTimeP50:1000,cpuTimeP95:3000,cpuTimeP99:6000}}]}={}){
 const queries=[];
 const query=async text=>{
  queries.push(text);
  if(text.includes('__type(name:"Account")')){
   assert.ok(text.split('args')[0].split('ofType').length>=4,'introspection must reach the row inside [Row!]!');
   return {__type:{fields:dataset?[{name:'pagesFunctionsInvocationsAdaptiveGroups',type:wrapped('PageRows'),
    args:[{name:'filter',type:{name:null,kind:'NON_NULL',ofType:{name:'PageFilter',kind:'INPUT_OBJECT'}}}]}]:[]}};
  }
  if(text.includes('row:__type'))return {row:{fields:[{name:'quantiles',type:{name:'PageQuantiles'}},
   {name:'sum',type:{name:'PageSums'}}]},filter:{inputFields:filters.map(name=>({name}))}};
  if(text.includes('q:__type'))return {q:{fields},s:{fields:sums.map(name=>({name}))}};
  return {viewer:{accounts:[{overall:rows}]}};
 };
 return {queries,run:(value=project)=>pagesMetrics(query,'account-test',value,window,summarizeMetrics,cpuSchema)};
}

test('Pages script filters use the production script identifier, not project or preview names',async()=>{
 const f=fixture(),report=await f.run();
 const request=f.queries.at(-1);
 assert.ok(request.includes('scriptName:"pages-worker--1234567-production"'));
 assert.ok(!request.includes(project.name));
 assert.ok(!request.includes(project.preview_script_name));
 assert.ok(request.includes('datetime_geq:'+JSON.stringify(window.start)));
 assert.ok(request.includes('datetime_leq:'+JSON.stringify(window.end)));
 assert.ok(request.includes('pagesFunctionsInvocationsAdaptiveGroups(limit:1'));
 assert.equal(report.status,'available');
 assert.equal(report.cpu.milliseconds.p95,3);
 assert.equal(report.performanceAcceptance,'pending');
});

test('missing production script stays pending instead of guessing a valid-looking project name',async()=>{
 for(const production_script_name of [undefined,null,'', '   ']){
  const f=fixture(),report=await f.run({...project,production_script_name});
  assert.equal(report.status,'pending');
  assert.equal(report.performanceAcceptance,'pending');
  assert.ok(!f.queries.some(text=>text.includes('viewer{accounts')));
 }
});

test('alternate project filters are used only when explicitly present in the live schema',async()=>{
 for(const [field,value] of [['projectId',project.id],['projectName',project.name]]){
  const f=fixture({filters:[field,'datetime_geq','datetime_leq']});
  assert.equal((await f.run()).status,'available');
  assert.ok(f.queries.at(-1).includes(`${field}:${JSON.stringify(value)}`));
 }
});

test('missing Pages dataset, time filter or CPU field remains pending without a metrics query',async()=>{
 for(const options of [{dataset:false},{filters:['scriptName','datetime_geq']},
  {fields:[{name:'cpuTimeP50',description:'microseconds'}]},{sums:['errors']}]){
  const f=fixture(options),report=await f.run();
  assert.equal(report.status,'pending');
  assert.equal(report.performanceAcceptance,'pending');
  assert.ok(!f.queries.some(text=>text.includes('viewer{accounts')));
 }
});

test('an empty Pages time window is data pending with null CPU rather than zero or passed',async()=>{
 const f=fixture({rows:[]}),report=await f.run();
 assert.equal(report.status,'data_pending');
 assert.equal(report.requests,null);
 assert.deepEqual(report.cpu.raw,{p50:null,p95:null,p99:null});
 assert.deepEqual(report.cpu.milliseconds,{p50:null,p95:null,p99:null});
 assert.equal(report.performanceAcceptance,'pending');
});

test('unknown Pages CPU units retain raw observations without invented millisecond conversion',async()=>{
 const f=fixture({fields:names.map(name=>({name,description:'CPU percentile'}))}),report=await f.run();
 assert.equal(report.cpu.sourceUnit,'unknown');
 assert.equal(report.cpu.unitVerified,false);
 assert.equal(report.cpu.raw.p95,3000);
 assert.equal(report.cpu.milliseconds,null);
 assert.equal(report.performanceAcceptance,'pending');
});

test('missing Pages P95 is not inferred from P50 or P99',async()=>{
 const f=fixture({fields:['cpuTimeP50','cpuTimeP99'].map(name=>({name,description:'CPU milliseconds'}))});
 const report=await f.run();
 assert.equal(report.cpu.p95Available,false);
 assert.equal(report.cpu.raw.p95,null);
 assert.equal(report.cpu.milliseconds.p95,null);
 assert.equal(report.performanceAcceptance,'pending');
});

test('Pages sampling stays separate from backend samples and cannot become an end-to-end percentile',async()=>{
 const report=await fixture().run();
 assert.equal(report.sampling.dataset,'pagesFunctionsInvocationsAdaptiveGroups');
 assert.equal(report.sampling.adaptive,true);
 assert.equal(report.sampling.averageSampleInterval,null);
 assert.equal(report.sampling.rawSampleCount,null);
 assert.deepEqual(report.outcomes,[]);
 assert.equal(report.cpu.milliseconds.p95,3);
 assert.match(report.note,/不能与后台CPU百分位相加/);
 assert.equal(report.performanceAcceptance,'pending');
});

test('multiple Pages aggregate rows fail closed instead of averaging or summing CPU percentiles',async()=>{
 const f=fixture({rows:[{sum:{requests:2},quantiles:{cpuTimeP95:5000}},
  {sum:{requests:2},quantiles:{cpuTimeP95:15000}}]});
 await assert.rejects(f.run(),/不能平均各组百分位数/);
});
