import test from 'node:test';
import assert from 'node:assert/strict';
import {createSourceClient,robotsPolicy,digest,SOURCE_ORIGIN} from '../../tools/calendar/fohui-fetch.mjs';
import {monthURL} from '../../tools/calendar/fohui-source.mjs';
import {getTibetanDate} from '../../static/calendar-reminders/engine.mjs';

const rules='User-agent: *\nCrawl-delay: 5\nAllow: /\n';
const page=(y=2027,m=3)=>`<link rel="canonical" href="${monthURL(y,m)}"><div id="jevents_body"><table class="cal_table">`+
  Array.from({length:new Date(Date.UTC(y,m,0)).getUTCDate()},(_,i)=>{const date=`${y}-${String(m).padStart(2,'0')}-${String(i+1).padStart(2,'0')}`;return `<td class="cal_dayshasevents"><a class="cal_daylink">${i+1}</a><a class="eventfull" title="藏历：${getTibetanDate(date).display}" data-content=""></a></td>`;}).join('')+'</table></div>';
const response=(body,status=200,headers={})=>new Response(body,{status,headers:{'content-type':'text/html; charset=utf-8',...headers}});
function harness(replies,options={}){
  let time=0;const calls=[],delays=[];
  const client=createSourceClient({now:()=>time,sleep:async ms=>{delays.push(ms);time+=ms;},fetchImpl:async(url,init)=>{calls.push({url,init,time});const reply=replies.shift();if(reply instanceof Error)throw reply;if(typeof reply==='function')return reply(url,init);if(!reply)throw new Error('unexpected fetch');return reply;},...options});
  return {client,calls,delays};
}
const robots=body=>response(body,200,{'content-type':'text/plain'});

test('robots longest match and explicit groups are recorded accurately',()=>{
  const p=robotsPolicy('User-agent: GPTBot\nDisallow: /\nUser-agent: *\nDisallow: /index.php/calendar/\nAllow: /index.php/calendar/monthcalendar/2027/3/-$\nCrawl-delay: 8\n');
  assert.equal(p.allowed(monthURL(2027,3)),true);assert.equal(p.allowed(monthURL(2027,4)),false);assert.equal(p.delayMs,8000);
  assert.equal(p.allowed('https://elsewhere.invalid/'),false);
  assert.throws(()=>robotsPolicy('<html>登录</html>'),/有效文本/);
});

test('disallowed paths need the explicit owner decision; without it no month request is sent',async()=>{
  const denied='User-agent: *\nDisallow: /index.php/calendar/\n';
  const a=harness([robots(denied)]);await a.client.checkPolicy(2027,3);
  await assert.rejects(a.client.month(2027,3),e=>e.code==='source-policy-blocked');assert.equal(a.calls.length,1);
  const b=harness([robots(denied),response(page())],{publicReadAuthorized:true});
  const policy=await b.client.checkPolicy(2027,3);assert.equal(policy.allowed,false);assert.equal(policy.publicReadAuthorized,true);
  assert.equal((await b.client.month(2027,3)).days.length,31);
  assert.equal(b.calls[1].init.redirect,'manual');assert.match(b.calls[1].init.headers['User-Agent'],/^HuidengCalendarSourceCheck/);
  assert.equal(b.calls[1].init.headers.Cookie,undefined);assert.ok(b.calls[1].time-b.calls[0].time>=5000);
});

test('conditional fetch uses a verified cache and 304 yields the original parsed facts',async()=>{
  const h=harness([robots(rules),response(page(),200,{etag:'"month-v1"'}),response(null,304)]);
  await h.client.checkPolicy(2027,3);const first=await h.client.month(2027,3),second=await h.client.month(2027,3);
  assert.deepEqual(second.days,first.days);assert.equal(second.cached,true);assert.equal(h.calls[2].init.headers['If-None-Match'],'"month-v1"');
  assert.equal(h.client.cache[monthURL(2027,3)].sha256,digest(page()));
});

test('unverifiable 304, login redirects, forbidden responses, and layout changes stop collection',async()=>{
  for(const [reply,code] of [[response(null,304),'invalid-cache'],[response('',302,{location:'/login'}),'source-http-error'],[response('',403),'source-http-error'],[response('<html>请登录</html>'),'source-layout-changed']]){
    const h=harness([robots(rules),reply],{publicReadAuthorized:true});await h.client.checkPolicy(2027,3);
    await assert.rejects(h.client.month(2027,3),e=>e.code===code);assert.equal(h.calls.length,2);
  }
});

test('retry limits and Retry-After apply to both seconds and HTTP dates',async()=>{
  const h=harness([robots(rules),response('',429,{'retry-after':'12'}),response('',503,{'retry-after':new Date(40000).toUTCString()}),response(page())]);
  await h.client.checkPolicy(2027,3);assert.equal((await h.client.month(2027,3)).days.length,31);
  assert.equal(h.calls.length,4);assert.ok(h.calls[2].time>=17000);assert.ok(h.calls[3].time>=40000);
  const long=harness([robots(rules),response('',429,{'retry-after':'3600'})]);await long.client.checkPolicy(2027,3);
  await assert.rejects(long.client.month(2027,3),e=>e.code==='source-busy');assert.equal(long.calls.length,2);
  const offline=harness([robots(rules),new Error('network'),new Error('network'),new Error('network')]);await offline.client.checkPolicy(2027,3);
  await assert.rejects(offline.client.month(2027,3),e=>e.code==='source-unreachable');assert.equal(offline.calls.length,4);
});

test('oversize pages and wrong MIME types never become calendar candidates',async()=>{
  for(const reply of [response('x',200,{'content-length':String(3*1024*1024)}),response('{}',200,{'content-type':'application/json'})]){
    const h=harness([robots(rules),reply]);await h.client.checkPolicy(2027,3);await assert.rejects(h.client.month(2027,3));
    assert.deepEqual(h.client.cache,{});
  }
});

test('only a recognizable empty future grid means unpublished; a known month cannot disappear',async()=>{
  const empty=`<link rel="canonical" href="${monthURL(2027,3)}"><div id="jevents_body"><table class="cal_table"><td class="cal_daysnoevents">1</td></table></div>`;
  const h=harness([robots(rules),response(empty),response(empty)]);await h.client.checkPolicy(2027,3);
  assert.equal((await h.client.month(2027,3,{allowUnpublished:true})).unpublished,true);
  await assert.rejects(h.client.month(2027,3),e=>e.code==='missing-published-month');
});
