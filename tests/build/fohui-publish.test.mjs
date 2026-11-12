import test from 'node:test';
import assert from 'node:assert/strict';
import {publish} from '../../tools/calendar/fohui-publish.mjs';
const base='a'.repeat(40),commit='b'.repeat(40);
const report={checkedAt:'2026-11-12T00:00:00Z',status:'ready',automaticEligible:true,newDays:25,editedDays:0,
  before:{end:'2027-05-06'},after:{end:'2027-05-31',factsSha256:'c'.repeat(64)},changes:[{kind:'coverage-extended'}]};
function harness({facts=report,concurrent=false,checkFails=false,mainRejects=false}={}){
  const calls=[],writes=new Map();let committed=false;
  const options={context:{GITHUB_ACTIONS:'true',GITHUB_REPOSITORY:'liuxiangdahai/huideng-calendar-trial',GITHUB_REF:'refs/heads/main',GITHUB_RUN_ID:'123'},
    read:async()=>JSON.stringify(facts),write:async(file,data)=>writes.set(file,data),
    command:(command,args)=>{
      calls.push([command,...args]);
      if(command==='git'){
        if(args[0]==='diff')return 'data/calendar/fohui-dates.json\nstatic/calendar-reminders/calendar-data.json';
        if(args[0]==='ls-files')return '';
        if(args[0]==='rev-parse')return args[1]==='origin/main'?(concurrent?'d'.repeat(40):base):committed?commit:base;
        if(args[0]==='commit')committed=true;
        if(args[0]==='push'&&args[2].endsWith(':refs/heads/main')&&mainRejects)throw new Error('branch protection');
        return '';
      }
      throw new Error('unexpected command');
    },
    dispatch:async(ref,sha,opts)=>{calls.push(['dispatch',ref,sha,opts]);if(checkFails)throw new Error('资料检查未通过');return {url:'https://github.com/liuxiangdahai/huideng-calendar-trial/actions/runs/123',sha};}
  };
  return {options,calls,writes};
}

test('automatic publication checks the candidate SHA, fast-forwards main, then explicitly dispatches release',async()=>{
  const h=harness(),receipt=await publish(h.options);
  const verify=h.calls.findIndex(c=>c[0]==='dispatch'&&c[1].startsWith('automation/'));
  const push=h.calls.findIndex(c=>c[0]==='git'&&c[1]==='push'&&c[3]===`${commit}:refs/heads/main`);
  const release=h.calls.findIndex(c=>c[0]==='dispatch'&&c[1]==='main');
  assert.ok(verify>=0&&verify<push&&push<release);assert.equal(h.calls[verify][2],commit);
  assert.equal(receipt.status,'release-requested');assert.ok(!h.calls.flat().some(c=>typeof c==='string'&&c.includes('--force')));
  assert.match(receipt.compareUrl,/\/compare\/main\.\.\.automation\/fohui-/);
  assert.ok(!h.calls.some(c=>c[0]==='gh'&&c[1]==='pr'),'no PR creation or review permissions needed');
});

test('failed checks or branch protection leave the candidate and never dispatch production',async()=>{
  for(const option of [{checkFails:true},{mainRejects:true}]){
    const h=harness(option);await assert.rejects(publish(h.options));
    assert.ok(!h.calls.some(c=>c[0]==='dispatch'&&c[1]==='main'));
    assert.ok(JSON.parse(h.writes.get('artifacts/source-maintenance/publication.json')).failure);
  }
});

test('a concurrent main edit is not overwritten and a source correction remains for review',async()=>{
  const a=harness({concurrent:true});await assert.rejects(publish(a.options));
  assert.ok(!a.calls.some(c=>c[0]==='git'&&c[1]==='push'));
  const b=harness({facts:{...report,status:'review-required',automaticEligible:false,editedDays:2,changes:[{kind:'moved'}]}});
  assert.equal((await publish(b.options)).status,'review-required');
  assert.ok(!b.calls.some(c=>c[0]==='dispatch'&&c[1]==='main'));
  assert.ok(!b.calls.some(c=>c[0]==='git'&&c[1]==='push'&&c[3].endsWith(':refs/heads/main')));
});
