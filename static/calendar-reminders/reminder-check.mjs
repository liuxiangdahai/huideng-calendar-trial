import ICAL from 'ical.js';
import {deviceTimeZone} from './timezones.mjs';
import {calendarEnvironment,appleSubscriptionUrl} from './calendar-entry.mjs';
import {makeProbeSettings,probeSchedule,probeExpiry,nextMorning} from './reminder-probe-model.mjs';
import {cloneSettings} from './runtime.mjs';

const $=id=>document.getElementById(id),KEY='huideng.reminder-probe.v1',environment=calendarEnvironment();
let state={},config,busy=false;
try{state=JSON.parse(localStorage.getItem(KEY)||'{}');}catch{}
const persist=()=>{try{localStorage.setItem(KEY,JSON.stringify(state));}catch{ $('notice').textContent='浏览器无法保存测试记录，请保留管理链接，并复制文字结果留存。'; }};
const note=text=>{$('notice').textContent=text;};
const fail=error=>{$('error').hidden=false;$('error').textContent=error instanceof TypeError?'连接未完成，请检查网络后重试；已保存的测试和观察记录会保留。':error.message || '操作未完成，请重试。';};
const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const zone=()=>state.subscription?.settings?.zone || deviceTimeZone();
const fmt=instant=>new Intl.DateTimeFormat('zh-CN',{timeZone:zone(),month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(instant));
async function request(path,options={}){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);
  try{
    const response=await fetch(path,{...options,signal:controller.signal,cache:'no-store',redirect:'error'});
    const body=await response.json();
    if(!response.ok){const error=new Error(body.error || '服务暂时不可用，请稍后重试。');error.status=response.status;throw error;}
    return body;
  }catch(error){if(error.name==='AbortError')throw new Error('等待超过15秒，尚不能确定提交结果。请重试上次提交，不要重复新建。');throw error;}
  finally{clearTimeout(timer);}
}
function validSubscription(value){
  const url=new URL(value.feedUrl);
  if(url.origin!==location.origin || !/^\/calendar\/[A-Za-z0-9_-]{43}\.ics$/.test(url.pathname) || !value.settings?.reminderProbe)throw new Error('此地址不是当前验收站的测试订阅。');
  return value;
}
function reportSnapshot(){
  const s=state.subscription;
  return {revision:s?.revision,settings:s?.settings,webSavedAt:state.webSavedAt,serverSavedAt:s?.updatedAt,serverCheck:state.serverCheck,
    phoneSeenAt:state.phoneSeenAt,results:state.results||{},notes:$('notes').value,manual:$('manual').value,recordedAt:new Date().toISOString()};
}
function render(){
  const s=state.subscription,expired=s && Date.now()>=Date.parse(probeExpiry(s.settings.reminderProbe)),active=s&&!s.disabled&&!expired;
  $('zone').textContent=`本轮时区：${zone() || '无法识别，请在设备设置中设定时区后刷新'}。测试时请保持手机日历使用相同时区。`;
  $('create').hidden=Boolean(active);$('create').textContent=s?'准备新的测试订阅':'准备测试订阅';
  $('create').disabled=!config || !zone() || Boolean(environment.inAppBrowser) || busy;
  $('retry').hidden=!state.pending;$('reload').hidden=!s;
  for(const id of ['subscription','observation','changes'])$(id).hidden=!s;
  if(!s)return;
  const p=s.settings.reminderProbe;
  $('feed').value=s.feedUrl;
  $('saved').textContent=s.disabled?'测试已停用；先核对手机撤销，再在手机移除此日历。':expired?'测试已到期，服务端取数将返回撤销。请在手机移除测试日历，或准备新的测试。':`设置版本 ${s.revision} · 有效至 ${fmt(probeExpiry(p))}。已保存，等待手机同步。`;
  $('round').textContent=`第 ${p.round} 轮 · A 预定 ${fmt(p.startAt)}；以下时间均为 ${s.settings.zone}。`;
  $('sync').textContent=state.phoneSeenAt?`你确认手机已同步本轮${s.disabled?'撤销':'日程'}：${fmt(state.phoneSeenAt)}。这仍不代表通知已通过。`:'尚未确认手机收到本轮日程或撤销。';
  $('seen').textContent=s.disabled?'我已在手机确认测试日程撤销':'我已在手机确认本轮日程及变更';
  const apple=appleSubscriptionUrl(s.feedUrl);
  $('open-calendar').hidden=!apple || Boolean(environment.inAppBrowser) || !active;
  if(apple)$('open-calendar').href=apple;
  $('manage').value=`${location.origin}${location.pathname}#probe=${s.id}.${state.manageToken}`;
  $('cases').innerHTML=probeSchedule(s.settings).map(item=>{
    const result=state.results?.[item.id]||{};
    const status=item.omitted||s.disabled?'已撤销；同步后不应再提醒':item.quiet?'仅显示，不应提醒':item.instants.map(fmt).join('、');
    return `<article class="probe-case"><h3>${escape(item.label)}</h3><p>${escape(status)}</p><p class="minor">${escape(item.detail)}</p>
      <label>实际结果<select data-result="${item.id}"><option value="pending">待观察</option><option value="received">已收到预期通知</option><option value="missed">到了时间，未收到</option><option value="missing-field">日程详情没有提醒时间</option><option value="silent">观察结束，没有通知</option><option value="unexpected">不应提醒，但收到了</option><option value="not-synced">手机尚未同步本轮</option></select></label>
      <details><summary>补充实际收到时间（可选）</summary><div class="results">${Array.from({length:item.id==='d'?2:1},(_,i)=>`<label>实际通知时间${item.id==='d'?i+1:''}<input type="datetime-local" step="1" data-time="${item.id}" data-index="${i}" value="${escape(result.times?.[i]||'')}"></label>`).join('')}</div></details></article>`;
  }).join('');
  for(const select of document.querySelectorAll('[data-result]'))select.value=state.results?.[select.dataset.result]?.status||'pending';
  for(const id of ['repeat','tomorrow','silent','remove','stop'])$(id).disabled=busy||!active;
  $('seen').disabled=busy;
}
async function run(action){if(busy)return;busy=true;$('error').hidden=true;document.querySelectorAll('[data-action]').forEach(b=>b.disabled=true);
  try{await action();}catch(error){
    // A validation rejection happens before creation; retrying an expired
    // timestamp forever would strand the user. Unknown network outcomes retain
    // the same nonce so they cannot accidentally create duplicate subscriptions.
    if(error.status===400 && state.pending?.method==='POST'){state.pending=null;persist();}
    fail(error);
  }finally{busy=false;document.querySelectorAll('[data-action]').forEach(b=>b.disabled=false);render();}}
async function submitPending(){
  const pending=state.pending;if(!pending)return;
  const s=state.subscription;
  const response=await request(pending.path,{method:pending.method,headers:{'Content-Type':'application/json',
    ...(pending.key?{'Idempotency-Key':pending.key}:{}),...(!pending.key?{Authorization:`Bearer ${state.manageToken}`}:{})},
    ...(pending.body?{body:JSON.stringify(pending.body)}:{})});
  if(pending.method==='DELETE'){state.history ||= [];state.history.push(reportSnapshot());state.subscription={...s,disabled:true};}
  else{
    validSubscription(response);
    if(s && response.revision!==s.revision){state.history ||= [];state.history.push(reportSnapshot());}
    state.subscription=response;state.manageToken=response.manageToken || state.manageToken;
  }
  state.pending=null;state.webSavedAt=new Date().toISOString();state.phoneSeenAt=null;state.results={};state.serverCheck=null;persist();render();
  note('服务端已保存。请在手机确认当前日程，再观察通知。');await checkFeed();
}
async function checkFeed(){
  const s=state.subscription;if(!s)return;
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);
  try{
    const saved=await request(`/api/subscriptions/${s.id}`,{headers:{Authorization:`Bearer ${state.manageToken}`}});
    s.updatedAt=saved.updatedAt;
    if(!s.disabled && saved.revision!==s.revision)throw new Error('设置已在另一页面变化，请先重新读取服务器，再开始观察。');
    const r=await fetch(s.feedUrl,{signal:controller.signal,cache:'no-store',redirect:'error'});
    if(!r.ok || !r.headers.get('content-type')?.includes('text/calendar'))throw new Error('订阅取数失败，未取得日历文件。');
    const text=await r.text();if(text.length>100000)throw new Error('测试文件大小异常。');
    const events=new ICAL.Component(ICAL.parse(text)).getAllSubcomponents('vevent');
    const items=events.map(e=>({uid:e.getFirstPropertyValue('uid'),title:e.getFirstPropertyValue('summary'),
      status:e.getFirstPropertyValue('status'),sequence:e.getFirstPropertyValue('sequence'),
      allDay:e.getFirstPropertyValue('dtstart').isDate,alarms:e.getAllSubcomponents('valarm').map(a=>({
        type:a.getFirstProperty('trigger').type,value:a.getFirstPropertyValue('trigger').toString(),
        seconds:a.getFirstProperty('trigger').type==='duration'?a.getFirstPropertyValue('trigger').toSeconds():null}))}));
    if(items.length!==6 || items.some(e=>!/^reminder-probe-[a-f]@/.test(e.uid)))throw new Error('测试日程不完整，请重新检查。');
    const expired=Date.now()>=Date.parse(probeExpiry(s.settings.reminderProbe));
    for(const expected of probeSchedule(s.settings)){
      const actual=items.find(e=>e.uid===`reminder-probe-${expected.id}@calendar.huidengvan.org`);
      const cancelled=s.disabled||expired||expected.omitted;
      const count=cancelled||expected.quiet?0:expected.instants.length;
      if(actual.alarms.length!==count || (actual.status==='CANCELLED')!==Boolean(cancelled))throw new Error(`测试 ${expected.id.toUpperCase()} 的文件提醒与保存设置不一致，请保留记录并反馈。`);
      if(!cancelled && !expected.quiet && expected.variant==='absolute-legacy' && actual.alarms.some((a,i)=>new Date(a.value).toISOString()!==expected.instants[i]))throw new Error('文件提醒时间与保存设置不一致，请反馈。');
      if(!cancelled && !expected.quiet && expected.variant==='relative'){
        const wanted=expected.reminders.map(r=>{const [h,m]=r.time.split(':').map(Number);return (h*60+m-r.daysBefore*1440)*60;}).sort((a,b)=>a-b);
        const got=actual.alarms.map(a=>a.seconds).sort((a,b)=>a-b);
        if(got.some((v,i)=>v!==wanted[i]))throw new Error('文件提醒时间与保存设置不一致，请反馈。');
      }
    }
    state.serverCheck={at:new Date().toISOString(),etag:r.headers.get('etag'),items};persist();
    const total=items.reduce((n,e)=>n+e.alarms.length,0);
    $('connection').textContent=`服务端检查 ${fmt(state.serverCheck.at)}：${items.length} 条测试日程，文件内 ${total} 次提醒。尚未验证手机接收或实际通知。`;
  }catch(error){$('connection').textContent='本次服务端检查失败；订阅地址仍保留，可重试检查。';throw error.name==='AbortError'?new Error('订阅文件读取超时，请换网络或稍后重试。'):error;}
  finally{clearTimeout(timer);}
}
async function change(action){
  if(state.pending && action!=='stop')throw new Error('上次提交尚未确认，请先重试或重新读取服务器，避免覆盖。');
  const s=state.subscription,settings=cloneSettings(s.settings),p=settings.reminderProbe;
  if(action==='repeat'||action==='tomorrow'){
    p.startAt=action==='tomorrow'?nextMorning(settings):new Date(Math.ceil(Date.now()/60000)*60000+30*60000).toISOString();
    p.round++;p.omit=[];p.silent=[];
  }else if(action==='silent'){p.silent=['a'];p.round++;}else if(action==='remove'){p.omit=['a'];p.round++;}
  state.pending={path:`/api/subscriptions/${s.id}`,method:action==='stop'?'DELETE':'PATCH',
    ...(action!=='stop'?{body:{settings,revision:s.revision}}:{})};persist();await submitPending();
}
async function copy(id){const value=$(id).value;try{await navigator.clipboard.writeText(value);note('已复制。复制不代表手机已添加。');}catch{$(id).hidden=false;$(id).focus();$(id).select();note('请长按或使用系统复制操作复制已选中的地址。');}}
$('create').onclick=()=>run(async()=>{
  if(state.pending){await submitPending();return;}
  if(state.subscription){state.history ||= [];state.history.push(reportSnapshot());state.subscription=null;}
  const key=btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');
  state.pending={path:'/api/subscriptions',method:'POST',key,body:{settings:makeProbeSettings(zone())}};persist();await submitPending();
});
$('retry').onclick=()=>run(submitPending);$('check').onclick=()=>run(checkFeed);
$('reload').onclick=()=>run(async()=>{const s=state.subscription;const data=await request(`/api/subscriptions/${s.id}`,{headers:{Authorization:`Bearer ${state.manageToken}`}});
  if(data.disabled)data.settings=s.settings;validSubscription(data);
  if(data.revision!==s.revision){state.history ||= [];state.history.push(reportSnapshot());state.phoneSeenAt=null;state.results={};}
  state.subscription=data;
  if(state.pending?.method==='PATCH')state.pending.body.revision=data.revision;
  persist();note('已读取服务器。若仍有未完成提交，可点“重试上次提交”保存原修改；此前观察记录已保留。');});
for(const id of ['repeat','tomorrow','silent','remove','stop'])$(id).onclick=()=>run(()=>change(id));
$('copy').onclick=()=>copy('feed');$('copy-manage').onclick=()=>copy('manage');
$('seen').onclick=()=>{state.phoneSeenAt=new Date().toISOString();persist();render();
  if(!state.subscription.disabled && Date.parse(state.subscription.settings.reminderProbe.startAt)-Date.now()<5*60000)note('提醒时间已临近或错过。请重新安排一轮，并确认手机同步后再观察。');};
$('cases').oninput=event=>{const input=event.target,id=input.dataset.result||input.dataset.time;if(!id)return;state.results ||= {};const r=state.results[id] ||= {status:'pending',times:[]};
  if(input.dataset.result)r.status=input.value;else r.times[Number(input.dataset.index)]=input.value;persist();};
for(const id of ['device','notes','manual']){$(id).value=state[id] || (id==='manual'?'pending':'');$(id).oninput=()=>{state[id]=$(id).value;persist();};}
$('copy-results').onclick=async()=>{
  const labels={pending:'待观察',received:'已收到预期通知',missed:'到了时间，未收到',
    'missing-field':'详情未显示提醒时间（未据此判断通知失败）',silent:'观察结束，没有通知',unexpected:'不应提醒但收到了','not-synced':'手机尚未同步本轮'};
  const rounds=[...(state.history||[]),reportSnapshot()].map(r=>{
    const p=r.settings?.reminderProbe;if(!p)return '';
    const local=value=>value?new Intl.DateTimeFormat('zh-CN',{timeZone:r.settings.zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).format(new Date(value)):'未记录';
    return [`第${p.round}轮 · 设置版本${r.revision} · 时区${r.settings.zone}`,
      `网页保存：${local(r.webSavedAt)}；服务器更新：${local(r.serverSavedAt)}`,
      `手机确认同步：${r.phoneSeenAt?local(r.phoneSeenAt):'尚未确认'}`,
      ...probeSchedule(r.settings).map(item=>`${item.id.toUpperCase()}：${labels[r.results?.[item.id]?.status]||'待观察'}；预定${item.quiet||item.omitted?'无提醒':item.instants.map(local).join('、')}；实收${r.results?.[item.id]?.times?.filter(Boolean).join('、')||'未记录'}`),
      `手动日程对照：${{received:'已收到',missed:'未收到'}[r.manual]||'尚未测试'}`,
      r.notes?`补充：${r.notes}`:''].filter(Boolean).join('\n');
  });
  const text=[`慧灯提醒测试（用户填写，非自动验收）`, `设备：${$('device').value||'未填写'}`,`设备时区：${deviceTimeZone()||'未知'}`,`页面版本：${config?.version||'未知'}`,...rounds].filter(Boolean).join('\n\n');
  $('result-text').value=text;
  try{await navigator.clipboard.writeText(text);$('result-text').hidden=true;$('result-copy-status').textContent='结果文字已复制，可粘贴到聊天。不含系统保存的订阅地址或管理凭证。';}
  catch{$('result-text').hidden=false;$('result-text').focus();$('result-text').select();$('result-copy-status').textContent='请长按或使用系统复制操作，复制下方已选中的文字。无需下载文件。';}
};
try{
  config=await request('./config.json');
  if(!['acceptance','local'].includes(config.environment))throw new Error('测试仅在隔离验收站开放，请使用提供的验收入口。');
  if(config.apiBaseUrl!==location.origin)throw new Error('测试接口与页面不是同一环境，已停止操作。');
  const restore=location.hash.match(/^#probe=([a-f0-9-]{36})\.([A-Za-z0-9_-]{43})$/);
  if(restore){history.replaceState(null,'',location.pathname);const restored=await request(`/api/subscriptions/${restore[1]}`,{headers:{Authorization:`Bearer ${restore[2]}`}});
    if(restored.disabled){state.subscription=null;state.pending=null;note('这个测试已停用，请另建测试。');}
    else{validSubscription(restored);state.manageToken=restore[2];state.subscription=restored;state.pending=null;state.phoneSeenAt=null;state.results={};}persist();}
  if(state.subscription)validSubscription(state.subscription);
  note(environment.inAppBrowser?'请点右上角菜单，选择在 Safari 或系统浏览器打开，再准备测试。不要在微信内反复尝试跳转。':'准备好后添加测试日历。只有手机实际弹出通知，才算提醒测试成功。');render();
}catch(error){config=null;fail(error);}
