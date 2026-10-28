import test from 'node:test';
import assert from 'node:assert/strict';
import {cpuSchema,summarizeMetrics} from '../../tools/calendar/cloudflare-metrics.mjs';

const fields=['cpuTimeP50','cpuTimeP95','cpuTimeP99'].map(name=>({name,description:'CPU time percentile - microseconds'}));
const data=(overall=[],outcomes=[])=>({viewer:{accounts:[{overall,outcomes}]}});
test('CPU quantiles use live units; absent P95 is not synthesized from P50/P99',()=>{
 const schema=cpuSchema(fields.filter(field=>field.name!=='cpuTimeP95'));
 const result=summarizeMetrics(data([{sum:{requests:10,errors:0,subrequests:2},quantiles:{cpuTimeP50:2000,cpuTimeP99:13000}}]),schema,false);
 assert.equal(result.cpu.p95Available,false);
 assert.deepEqual(result.cpu.milliseconds,{p50:2,p95:null,p99:13});
 assert.equal(result.performanceAcceptance,'pending');
});
test('CPU values without confirmed units retain raw evidence without conversion',()=>{
 const schema=cpuSchema([]);
 const result=summarizeMetrics(data([{sum:{requests:1},quantiles:{cpuTimeP50:42,cpuTimeP99:42}}]),schema,false);
 assert.equal(result.cpu.sourceUnit,'unknown');
 assert.equal(result.cpu.milliseconds,null);
 assert.equal(result.cpu.raw.p50,42);
 assert.equal(result.cpu.unitVerified,false);
});
test('no samples are pending, not zero CPU; adaptive counts do not become exact sample sizes',()=>{
 const empty=summarizeMetrics(data(),cpuSchema(fields),true);
 assert.equal(empty.status,'data_pending');
 assert.equal(empty.cpu.raw.p95,null);
 const sampled=summarizeMetrics(data([{sum:{requests:200,errors:0},quantiles:{cpuTimeP95:8000},avg:{sampleInterval:4}}]),cpuSchema(fields),true);
 assert.equal(sampled.sampling.averageSampleInterval,4);
 assert.equal(sampled.sampling.rawSampleCount,null);
 assert.equal(sampled.cpu.milliseconds.p95,8);
});
test('aggregation cannot average percentiles or leak untrusted dimension fields',()=>{
 assert.throws(()=>summarizeMetrics(data([{},{}]),cpuSchema(fields),false));
 assert.throws(()=>summarizeMetrics({viewer:{accounts:[]}},cpuSchema(fields),false));
 const result=summarizeMetrics(data([],[{dimensions:{status:'credential@example.test',url:'secret'},sum:{requests:1,errors:1}}]),cpuSchema(fields),false);
 assert.deepEqual(result.outcomes,[{status:'other',requests:1,errors:1}]);
 assert.ok(!JSON.stringify(result).includes('credential'));
});
