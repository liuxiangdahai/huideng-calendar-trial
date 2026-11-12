import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {readSourceState,prepareUpdate,plannedMonths,collectMonths,applyCandidate,OUTPUTS,INPUTS} from '../../tools/calendar/fohui-maintenance-core.mjs';
import {publicationPolicy} from '../../tools/calendar/fohui-publish.mjs';
import {getTibetanDate,generateOccurrences} from '../../static/calendar-reminders/engine.mjs';
import {monthURL} from '../../tools/calendar/fohui-source.mjs';

const {source:existing,ledger}=JSON.parse(await fs.readFile('tests/fixtures/fohui-baseline.json','utf8'));
const catalog=JSON.parse(await fs.readFile('data/calendar/catalog.json','utf8'));
const now=new Date('2026-11-09T02:00:00Z');
const state=()=>({existing:structuredClone(existing),ledger:structuredClone(ledger),catalog,log:{schemaVersion:1,entries:[]},baseDigests:{}});
const month=(y,m)=>structuredClone(existing.days.filter(d=>d.date.startsWith(`${y}-${String(m).padStart(2,'0')}`)));
function extension(){
  const incoming=month(2027,5);
  for(let d=7;d<=31;d++){
    const date=`2027-05-${String(d).padStart(2,'0')}`;
    incoming.push({date,tibetan:getTibetanDate(date).display,labels:[],source:monthURL(2027,5)});
  }
  for(const event of generateOccurrences({catalog},{start:'2027-05-07',end:'2027-05-31'})){
    const def=catalog.events.find(e=>e.id===event.eventId);
    incoming.find(d=>d.date===event.date).labels.push(def.sourceLabel||(def.sourceLabels[0]));
  }
  incoming.find(d=>d.date==='2027-05-14').labels.push('金刚萨埵法会开始');
  return incoming;
}

test('HTML hash changes and label order alone do not change data, dates, IDs or versions',()=>{
  const s=state(),before=JSON.stringify(s),incoming=month(2027,3);
  incoming.forEach(d=>d.labels.reverse());
  const result=prepareUpdate(s,{incoming,snapshots:[{url:monthURL(2027,3),sha256:'changed-dynamic-html'}]},{now});
  assert.equal(result.report.status,'unchanged');assert.equal(result.candidate,null);assert.equal(JSON.stringify(s),before);
});

test('a complete future extension stages stable IDs and may hand off to the release checks',()=>{
  const {report,candidate}=prepareUpdate(state(),{incoming:extension(),snapshots:[]},{now});
  assert.equal(report.status,'ready');assert.equal(report.newDays,25);assert.equal(report.editedDays,0);
  const next=JSON.parse(candidate.files[OUTPUTS[1]]);
  assert.deepEqual(next.records.filter(r=>ledger.records.some(old=>old.recordId===r.recordId)),ledger.records);
  assert.ok(next.records.some(r=>r.date==='2027-05-14'&&r.eventId==='vajrasattva-assembly-start'));
  assert.equal(publicationPolicy(report,[...OUTPUTS,'static/calendar-reminders/feeds/nature.ics']).automatic,true);
  assert.throws(()=>publicationPolicy(report,[...OUTPUTS,'static/calendar-reminders/app.mjs']),/不能提交/);
});

test('a corrected published occurrence is prepared for review, never auto-merged as an extension',()=>{
  const incoming=month(2027,3);
  incoming.find(d=>d.date==='2027-03-21').labels=incoming.find(d=>d.date==='2027-03-21').labels.filter(l=>l!=='春分');
  incoming.find(d=>d.date==='2027-03-20').labels.push('春分');
  const {report,candidate}=prepareUpdate(state(),{incoming,snapshots:[]},{now});
  assert.equal(report.status,'review-required');assert.ok(candidate);assert.equal(report.automaticEligible,false);
  assert.equal(publicationPolicy(report,OUTPUTS).automatic,false);
  assert.equal(report.changes.find(c=>c.kind==='moved').recordId,ledger.records.find(r=>r.sourceLabel==='春分').recordId);
});

test('date-only publication cannot silently suppress future recurring observances',()=>{
  const incoming=extension();for(const d of incoming.filter(d=>d.date>'2027-05-06'))d.labels=[];
  const {report,candidate}=prepareUpdate(state(),{incoming,snapshots:[]},{now});
  assert.equal(candidate,null);assert.equal(report.status,'review-required');
  assert.ok(report.changes.some(c=>c.kind==='unconfirmed-recurring'&&c.eventId==='guru-tsok'));
});

test('unknown names, shrinking coverage and incomplete months never produce an applicable candidate',()=>{
  for(const incoming of [month(2027,3).slice(0,-1),month(2027,3).map((d,i)=>i?d:{...d,labels:['尚未归类的原文']})]){
    const {report,candidate}=prepareUpdate(state(),{incoming,snapshots:[]},{now});
    assert.equal(candidate,null);assert.equal(report.status,'review-required');assert.ok(report.changes.some(c=>c.blocking));
  }
});

test('year rollover still includes the last confirmed month so gaps can be filled',()=>{
  const months=plannedMonths(existing,new Date('2028-01-01T00:00:00Z'));
  assert.deepEqual(months[0],[2027,5]);assert.deepEqual(months.at(-1),[2029,12]);
  assert.throws(()=>plannedMonths(existing,new Date('2030-01-01T00:00:00Z')),/36个月/);
});

test('partial last publication is allowed; a later published month after a gap is not',async()=>{
  const client={requests:[],checkPolicy:async()=>({allowed:true}),month:async(y,m)=>{
    const days=month(y,m);return {days,unpublished:!days.length,snapshot:{url:monthURL(y,m),days:days.length,sha256:'test'}};
  }};
  const result=await collectMonths(client,existing,now);
  assert.equal(result.incoming.at(-1).date,'2027-05-06');assert.equal(result.observations.at(-1).state,'unpublished');
  const old=client.month;
  client.month=async(y,m)=>m===6?{days:[{date:'2027-06-01',tibetan:getTibetanDate('2027-06-01').display,labels:[]}],snapshot:{}}:old(y,m);
  await assert.rejects(collectMonths(client,existing,now),e=>e.code==='publication-gap');
});

async function tempState(t){
  const root=await fs.mkdtemp(path.join(await fs.realpath(tmpdir()),'fohui-maintenance-'));
  t.after(async()=>{assert.equal(path.dirname(root),await fs.realpath(tmpdir()));assert.ok(path.basename(root).startsWith('fohui-maintenance-'));await fs.rm(root,{recursive:true,force:true});});
  await fs.mkdir(path.join(root,'data/calendar'),{recursive:true});
  for(const [i,value] of [existing,ledger,catalog].entries())await fs.writeFile(path.join(root,INPUTS[i]),JSON.stringify(value,null,2)+'\n');
  return root;
}

test('applying a candidate is idempotent and refuses concurrent source/catalog edits',async t=>{
  const root=await tempState(t),s=await readSourceState(root);
  const {candidate}=prepareUpdate(s,{incoming:extension(),snapshots:[]},{now});
  await fs.appendFile(path.join(root,INPUTS[2]),' ');
  await assert.rejects(applyCandidate(candidate,root),/新改动/);
  assert.deepEqual((await readSourceState(root)).existing,existing);
  await fs.writeFile(path.join(root,INPUTS[2]),JSON.stringify(catalog,null,2)+'\n');
  await applyCandidate(candidate,root);
  const after=await readSourceState(root);
  assert.equal(after.existing.end,'2027-05-31');
  assert.equal(prepareUpdate(after,{incoming:extension(),snapshots:[]},{now}).candidate,null);
  await assert.rejects(applyCandidate({...candidate,files:{'../elsewhere':'{}'}},root),/文件列表/);
});
