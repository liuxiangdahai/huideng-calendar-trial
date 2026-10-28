import {defaults, normalizeSettings, selectOccurrences, exportICS, reminderLabel, addDays, rangeEnd} from './core.mjs';
import {getTibetanDate} from './engine.mjs';
import {icon, fillIcons} from './icons.mjs';
import {deviceTimeZone,resolveTimeZone,zoneInfo,wallTimeInZone} from './timezones.mjs';
import {deviceDate,nextLocalMidnight,changedDeviceZone} from './device-time.mjs';
import {createZonePicker} from './zone-picker.mjs';
import {createCalendarView} from './calendar-view.mjs';
import {createSubscriptionGuide} from './subscription-guide.mjs';
import {reminderTestICS} from './reminder-test.mjs';
import {PRESETS,presetIds,applyPreset,matchingPreset} from './presets.mjs';
import {timeComparison} from './time-comparison.mjs';
import {eventPresentation,eventIcon} from './event-presentation.mjs';
import {calendarEnvironment,appleSubscriptionUrl,GOOGLE_ADD_URL} from './calendar-entry.mjs';
import {cloneSettings as clone,fetchJSON} from './runtime.mjs';
import {createMobileTabs} from './mobile-tabs.mjs';

const $ = selector => document.querySelector(selector);
const storageKey = 'huideng.calendar.v2', subscriptionKey = 'huideng.calendar.subscription';
const uiKey = 'huideng.calendar.interface';
const creationKey = 'huideng.calendar.creation';
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const defaultReminders = () => [{daysBefore:0,time:'08:00'}];
const readStored = key => { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } };
let data, settings, subscription = null, apiBaseUrl = '', upcoming = [];
let calendarView,zonePicker,guide,ui={},observedZone='',today='',dayTimer;
let reminderTarget = [], reminderDraft, reminderReturnSelector, requestPending = false, conflict = false, stopped = false;
let openGroups = new Set(['tsok']), lastActive = new Map();
let managementAttempt = 0;
let managementRestoring = false;
let subscriptionVersion = 0, pendingWrite = null;
let entryError = false;
let pendingCreation = null, creationBlocked = false;
const calendarDevice = calendarEnvironment();
const countSelected = () => Object.values(settings.events).filter(pref => pref.mode !== 'off').length;
const dirty = () => Boolean(subscription && JSON.stringify(settings) !== JSON.stringify(subscription.savedSettings));
const zoneLabel = () => settings.zone ? zoneInfo(settings.zone)?.label || settings.zone : '尚未选择时区';
const currentApp = () => $('input[name="device"]:checked')?.value || '';
const hasReminders = () => Object.values(settings.events).some(pref=>pref.mode==='remind');
function persistUI() { try {localStorage.setItem(uiKey,JSON.stringify(ui));} catch {} }

function notify(message) {
  $('#toast').textContent = message; $('#toast').hidden = false;
  clearTimeout(notify.timer); notify.timer = setTimeout(() => { $('#toast').hidden = true; }, 4000);
}
function persist() {
  try {
    localStorage.setItem(storageKey,JSON.stringify(settings));
    if (subscription) localStorage.setItem(subscriptionKey,JSON.stringify(subscription));
    else localStorage.removeItem(subscriptionKey);
  } catch { notify('浏览器未能保存本机设置；本次仍可使用，请保存管理链接。'); }
}
function storeCreationAttempt() {
  try {
    if (pendingCreation) localStorage.setItem(creationKey,JSON.stringify(pendingCreation));
    else localStorage.removeItem(creationKey);
  } catch { notify('浏览器未能保存创建进度，请保持此页面打开并重试；完成后请保存管理链接。'); }
}
function creationAttempt() {
  if (pendingCreation) return pendingCreation;
  // Read again for a retry from another tab. A retry always sends the original
  // body; later edits stay in the draft and are saved with PATCH after recovery.
  const stored=readStored(creationKey);
  if (stored?.apiBaseUrl===apiBaseUrl && /^[A-Za-z0-9_-]{43}$/.test(stored.key) &&
      stored.settings && typeof stored.settings==='object' && !Array.isArray(stored.settings)) {
    pendingCreation=stored;
  } else {
    const key=btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))))
      .replaceAll('+','-').replaceAll('/','_').replaceAll('=','');
    pendingCreation={apiBaseUrl,key,settings:clone(settings)};
    storeCreationAttempt();
  }
  return pendingCreation;
}
function safeHTTP(value) {
  try {
    const url = new URL(value);
    if (url.username || url.password) return '';
    return url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost','127.0.0.1','[::1]'].includes(url.hostname)) ? url.href : '';
  } catch { return ''; }
}
function renderToday() {
  const now=new Date(); today=deviceDate(now);
  $('#today-gregorian').textContent = new Intl.DateTimeFormat('zh-CN',{year:'numeric',month:'long',day:'numeric',weekday:'short'}).format(now);
  try { $('#today-tibetan').textContent = `藏历 ${getTibetanDate(today).display}`; }
  catch { $('#today-tibetan').textContent = ''; }
}
function renderRegion(now=new Date()) {
  const info=settings.zone ? zoneInfo(settings.zone,now) : null;
  $('#zone-summary').textContent=info ? `${info.label} · ${info.offset}` : '请选择提醒时区';
  const clocks=timeComparison(now,observedZone,settings.zone);
  const clock=(value,label)=>`<div class="clock-item"><span>${esc(label)}</span><strong>${esc(value.time)}</strong><small>${esc(value.label)}${clocks.reminder?.dayLabel ? ` · ${esc(value.date)}${value.dayLabel?`（${esc(value.dayLabel)}）`:''}` : ''}</small></div>`;
  $('#time-comparison').innerHTML=clock(clocks.device,clocks.merged?'设备与提醒时间':'设备时间')+(!clocks.merged&&clocks.reminder?clock(clocks.reminder,'提醒地区时间'):'');
  const changed=changedDeviceZone(ui.lastDeviceZone,observedZone,settings.zone);
  $('#device-zone-notice').hidden=!changed;
  if(changed) $('#device-zone-message').textContent=`设备已使用${zoneInfo(observedZone).label}。提醒仍使用${zoneLabel()}，可选择是否调整。`;
}
function checkDeviceTime() {
  const previousToday=today, previousZone=observedZone;
  observedZone=deviceTimeZone(); renderToday(); renderRegion();
  if (today!==previousToday || observedZone!==previousZone) renderPreview();
  clearTimeout(dayTimer); dayTimer=setTimeout(checkDeviceTime,Math.min(nextLocalMidnight(),60000-Date.now()%60000+50));
}
function renderPresets() {
  const current=matchingPreset(settings,data.catalog);
  $('#preset-options').innerHTML=PRESETS.map(preset=>`<button class="preset-card" type="button" data-preset="${preset.id}" aria-pressed="${current===preset.id}"${preset.id==='practice'?' aria-describedby="preset-scope-note"':''}><span class="preset-icon">${icon(preset.icon)}</span><span class="preset-copy"><strong>${preset.title}<small>${presetIds(data.catalog,preset.id).length} 项</small></strong><span>${preset.description}</span><em>提醒：${preset.reminder}</em></span><span class="preset-check" aria-hidden="true">${current===preset.id?icon('check'):''}</span></button>`).join('');
  $('#clear-selection').disabled=!countSelected();
}
function renderGroups() {
  openGroups = new Set([...document.querySelectorAll('.group-card[open]')].map(item => item.dataset.groupId).concat($('#groups').children.length ? [] : [...openGroups]));
  $('#groups').innerHTML = data.catalog.groups.map(group => {
    const all = data.catalog.events.filter(event => event.group === group.id);
    const count = all.filter(event => settings.events[event.id].mode !== 'off').length;
    return `<details class="group-card event-category-${esc(group.id)}" data-group-id="${esc(group.id)}" ${openGroups.has(group.id) ? 'open' : ''}>
      <summary><span class="group-icon">${eventIcon({group:group.id},data.catalog)}</span><span class="group-name"><strong>${esc(group.name)}</strong><small>${all.length} 项</small></span><span class="group-count ${count ? 'has-selected' : ''}">${count ? `已选 ${count} 项` : '未选择'}</span><span class="chevron">${icon('chevron')}</span></summary>
      <div class="group-tools"><div><button type="button" class="text-button" data-select-group="${esc(group.id)}">全选</button><button type="button" class="text-button" data-clear-group="${esc(group.id)}" ${!count ? 'disabled' : ''}>清空</button></div><button type="button" class="text-button" data-reminder-group="${esc(group.id)}" ${!count ? 'disabled' : ''}>${icon('bell-settings')}统一提醒</button></div>
      <div class="event-list">${all.map(event => {
        const pref = settings.events[event.id], active = pref.mode !== 'off';
        const label = pref.mode === 'remind' ? (pref.reminders.length === 2 ? '两次提醒' : reminderLabel(pref.reminders)) : '仅显示';
        return `<div class="event-row ${eventPresentation(event,data.catalog).colorClass}"><label class="event-label"><input type="checkbox" data-event="${esc(event.id)}" id="event-${esc(event.id)}" ${active ? 'checked' : ''}><span><span class="event-title">${esc(event.title)}</span><span class="event-rule">${esc(event.ruleLabel)}</span></span></label><button type="button" class="event-reminder ${pref.mode === 'remind' ? 'active' : ''}" data-reminder-event="${esc(event.id)}" aria-label="${esc(event.title)}的提醒设置" ${!active ? 'disabled' : ''}>${icon(pref.mode === 'remind' ? 'bell' : 'bell-off')}<span>${esc(label)}</span></button></div>`;
      }).join('')}</div></details>`;
  }).join('');
}
function renderPreview() {
  $('#preview-error').hidden = true;
  renderToday();
  const start=addDays(today,-90),end=rangeEnd(today,24);
  let events=[];
  try {
    events=(countSelected() ? selectOccurrences(data,settings,{start,end}) : []).sort((a,b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title,'zh'));
    upcoming = events.filter(event=>event.date>=today);
  } catch (error) {
    upcoming = []; $('#preview-error').textContent = error.message; $('#preview-error').hidden = false;
  }
  calendarView?.update({data,settings,events,today,start,end,deviceZone:observedZone});
  $('#reminder-settings').disabled=!countSelected();
  renderRegion(); renderSaveState();
}
function renderSaveState() {
  const changed = dirty(), count = countSelected();
  $('#selection-count').textContent = `已选 ${count} 项`;
  $('#reminder-count').textContent = `${Object.values(settings.events).filter(pref=>pref.mode==='remind').length} 项提醒`;
  $('#subscribe').setAttribute('aria-busy',String(requestPending||managementRestoring));
  $('#save-state').textContent = stopped ? '已停用，请在手机移除订阅日历' : conflict ? '设置已在其他设备修改' : changed ? '有未保存的修改' : subscription ? '设置已保存，等待日历同步' : '随时调整你的选择';
  $('#unsaved-dot').hidden = !changed;
  $('#subscribe-label').textContent = managementRestoring ? '正在恢复订阅…' : requestPending ? '正在保存…' : subscription ? (changed ? '保存修改' : '查看订阅') : '订阅到日历';
  $('#subscribe').disabled = requestPending || managementRestoring || (!subscription && !count);
  // This opens the existing panel only. Keep it available while saving so a
  // user who closed the panel can return to progress, help or a failure state.
  $('#my-subscription').disabled = false;
}
function refresh(rebuild = true) {
  const focusId = document.activeElement?.id;
  if (rebuild) renderGroups();
  renderPreview(); renderPresets(); persist();
  if (focusId?.startsWith('event-')) document.getElementById(focusId)?.focus({preventScroll:true});
}
function renderReminderFields() {
  const enabled = reminderDraft.mode === 'remind';
  $('#reminder-fields').hidden = !enabled;
  $('#reminder-fields').innerHTML = reminderDraft.reminders.map((reminder,index) => `<div class="reminder-row"><label>第 ${index+1} 次提醒<select data-reminder-index="${index}" data-reminder-field="daysBefore" aria-label="第${index+1}次提醒日期" ${!enabled ? 'disabled' : ''}>${[[0,'当天'],[1,'提前一天'],[2,'提前两天'],[7,'提前一周']].map(([value,label]) => `<option value="${value}" ${reminder.daysBefore === value ? 'selected' : ''}>${label}</option>`).join('')}</select></label><label>具体时间<input type="time" required value="${esc(reminder.time)}" data-reminder-index="${index}" data-reminder-field="time" aria-label="第${index+1}次提醒时间" ${!enabled ? 'disabled' : ''}></label><button type="button" class="icon-button" data-remove-reminder="${index}" aria-label="删除第${index+1}次提醒" ${reminderDraft.reminders.length === 1 ? 'disabled' : ''}>${icon('close')}</button></div>`).join('') + (reminderDraft.reminders.length < 2 ? `<button type="button" class="text-button" id="add-reminder">${icon('plus')}再加一次提醒</button>` : '');
}
function openReminders(ids, title, trigger=document.activeElement) {
  const key=['data-cal-focus','data-reminder-event','data-reminder-group'].find(name=>trigger?.hasAttribute(name));
  reminderReturnSelector=key ? `[${key}="${CSS.escape(trigger.getAttribute(key))}"]` : trigger?.id ? `#${CSS.escape(trigger.id)}` : null;
  reminderTarget = ids.filter(id => settings.events[id]?.mode !== 'off');
  reminderDraft = clone(settings.events[reminderTarget[0]] || {mode:'display',reminders:defaultReminders()});
  if (!reminderDraft.reminders.length) reminderDraft.reminders = defaultReminders();
  $('#reminder-title').textContent = title;
  $('#reminder-scope-note').textContent = reminderTarget.length > 1 ? `应用后将统一这 ${reminderTarget.length} 项已选日程的提醒；未选项目保持不变。` : '这项日程单独设置，其他日程保持不变。';
  $(`input[name="reminder-mode"][value="${reminderDraft.mode}"]`).checked = true;
  $('#reminder-error').hidden = true;
  renderReminderFields(); $('#reminder-dialog').showModal();
}
function deviceGuide() {
  const app=currentApp();
  const appleUrl=appleSubscriptionUrl(subscription?.feedUrl);
  const ready=Boolean(subscription && !requestPending && !managementRestoring && !dirty() && !conflict);
  guide?.update({app,hasReminders:hasReminders(),hasSubscription:Boolean(subscription),preparing:requestPending||managementRestoring,entryReady:ready});
  const apple=$('#iphone-subscribe');
  apple.hidden = app !== 'iphone' || !calendarDevice.apple || !appleUrl;
  if(ready) apple.removeAttribute('aria-disabled'); else apple.setAttribute('aria-disabled','true');
  apple.tabIndex=ready ? 0 : -1;
  if(ready && appleUrl) apple.href=appleUrl; else apple.removeAttribute('href');
  const google=$('#google-subscribe');
  google.hidden=app!=='google'||calendarDevice.mobile||!subscription;
  if(ready) google.removeAttribute('aria-disabled'); else google.setAttribute('aria-disabled','true');
  google.tabIndex=ready ? 0 : -1;
  if(ready) google.href=GOOGLE_ADD_URL; else google.removeAttribute('href');
  $('#copy-feed').disabled=!ready;
  $('#copy-feed').classList.toggle('primary',app==='other'||app==='google'&&calendarDevice.mobile||app==='iphone'&&!calendarDevice.apple);
  $('#copy-feed').classList.toggle('secondary',!$('#copy-feed').classList.contains('primary'));
  $('#entry-hint').textContent=managementRestoring ? '正在恢复订阅，请稍候。' : !app ? '选择日历应用后，查看对应的添加方式。' : requestPending ? '正在保存你的选择，请稍候。' : !subscription ? '选好日历应用后，我们会准备你的订阅。' : !ready ? '先保存修改，再继续添加到日历。' : app==='iphone' ? calendarDevice.apple ? '将在系统日历中打开订阅确认，请按提示添加。' : '请把订阅地址传到你的 iPhone、iPad 或 Mac 上添加。' : app==='google' ? calendarDevice.mobile ? '请将订阅地址传到电脑，在 Google 日历网页中添加。' : '先复制订阅地址，再打开 Google 日历的“通过网址添加”页面。' : '应用有网址订阅入口时可粘贴此地址；否则请查看下方文件导入方式。';
  $('#create-subscription').disabled = !app || !countSelected() || requestPending || managementRestoring || !settings.zone || creationBlocked;
  $('#create-subscription-label').textContent=managementRestoring ? '正在恢复订阅…' : requestPending ? '正在准备订阅…' : entryError ? '重试准备订阅' : app ? '继续订阅' : '请先选择日历应用';
  $('#subscription-new').setAttribute('aria-busy',String(requestPending||managementRestoring));
  $('#restart-creation').hidden=Boolean(subscription)||!creationBlocked;
  $('#restart-creation').disabled=requestPending||managementRestoring;
}
function renderSubscription() {
  $('#subscription-summary').textContent = `已选 ${countSelected()} 项 · 全天显示 · ${zoneLabel()}`;
  $('#subscription-new').hidden = Boolean(subscription);
  $('#subscription-existing').hidden = !subscription;
  $('#subscription-management').hidden = !subscription;
  $('#create-subscription').disabled = !countSelected() || requestPending;
  $('#save-subscription').hidden = !dirty();
  $('#save-subscription').disabled = requestPending || managementRestoring || conflict;
  $('#reload-subscription').hidden = !conflict;
  if (subscription) {
    $('#feed-url').value = subscription.feedUrl;
    $('#subscription-status').textContent = dirty() ? '当前修改尚未保存；日历仍使用上次保存的设置。' : '设置已保存，等待日历同步。订阅地址保持不变。';
  }
  $('#downloads').innerHTML = ['remind','display'].map(mode => {
    const count = upcoming.filter(event => event.preference.mode === mode).length;
    return count ? `<button class="secondary" type="button" data-download="${mode}">${icon('download')}下载${mode === 'remind' ? '提醒' : '仅显示'}日历 · ${count} 项日程</button>` : '';
  }).join('') || '<p>近期没有可下载的已选日程。</p>';
  deviceGuide(); renderSaveState();
}
function openSubscription({prepare=false}={}) {
  if(!entryError) $('#subscription-error').hidden = true;
  $('#stop-confirmation').hidden = true;
  $('#entry-attempt').hidden=true;
  if(!currentApp() && calendarDevice.recommendedApp) {
    $(`input[name="device"][value="${calendarDevice.recommendedApp}"]`).checked=true;
    ui.app=calendarDevice.recommendedApp; persistUI();
  }
  renderSubscription();
  if (!$('#subscription-dialog').open) $('#subscription-dialog').showModal();
  if(prepare) {
    if(subscription && dirty()) void saveSubscription();
    else void prepareSubscription();
  }
}
async function prepareSubscription({retry=false}={}) {
  if(subscription || requestPending || managementRestoring || creationBlocked || !currentApp() || !countSelected() || !settings.zone) return;
  // Changing the target app must not silently retry a failed/expired creation.
  if(entryError&&!retry) return;
  await saveSubscription(true);
}
async function api(method, path, body, manageToken = subscription?.manageToken, creationNonce) {
  if (!apiBaseUrl) throw new Error('暂时无法完成订阅，请稍后重试。你的选择已保留，也可以使用下方文件导入。');
  const headers = {'Accept':'application/json'};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (manageToken) headers.Authorization = `Bearer ${manageToken}`;
  if (creationNonce) headers['Idempotency-Key']=creationNonce;
  let response, result;
  try { ({response,result} = await fetchJSON(`${apiBaseUrl}${path}`,{method,headers,body:body === undefined ? undefined : JSON.stringify(body),cache:'no-store'})); }
  catch { throw new Error('暂时无法连接订阅服务。你的本机选择已保留，请稍后重试。'); }
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    throw new Error('订阅服务返回的信息不完整。你的选择和创建进度已保留，请稍后重试。');
  }
  if (!response.ok) {
    const error = new Error(typeof result.error === 'string' ? result.error : result.error?.message || result.message || '订阅服务暂时无法完成此操作。');
    error.status = response.status; error.code=result.code; throw error;
  }
  return result;
}
function showSubscriptionError(error) {
  entryError=true;
  if (pendingCreation && !subscription && (String(error.code||'').startsWith('creation_') || [400,413,415].includes(error.status))) {
    creationBlocked=true;
    pendingCreation.blocked={message:error.message,status:error.status,code:error.code||'creation_rejected'};
    storeCreationAttempt();
  }
  if (error.status === 409 && !String(error.code||'').startsWith('creation_')) {
    conflict = true;
    $('#subscription-error').textContent = '这份订阅已在其他设备修改。请重新载入已保存设置后再调整，避免覆盖另一台设备的修改。';
  } else $('#subscription-error').textContent = error.message;
  $('#subscription-error').hidden = false; renderSubscription();
}
function clearSubscriptionError() {
  entryError=false; creationBlocked=false;
  $('#subscription-error').hidden=true;
}
function acceptRemote(result, force = false) {
  if (result.disabled) {
    clearSubscriptionError();
    subscription = null; conflict = false; stopped = true; persist(); renderSaveState(); renderSubscription();
    notify('这份订阅已停用。请在手机日历中移除原订阅。');
    return;
  }
  const remote = normalizeSettings(result.settings,data.catalog);
  const feedUrl=safeHTTP(result.feedUrl || subscription?.feedUrl);
  if(!feedUrl) throw new Error('订阅服务返回的地址无效。你的选择已保留，请稍后重试。');
  clearSubscriptionError();
  if (force || !dirty()) {settings = clone(remote);}
  subscription = {...subscription,id:result.id || subscription?.id,manageToken:result.manageToken || subscription?.manageToken,
    feedUrl,revision:result.revision,savedSettings:remote};
  conflict = false; stopped = false; refresh(); renderSubscription();
}
async function loadSubscription(force = false) {
  if (!subscription || !apiBaseUrl || managementRestoring || requestPending) return false;
  const version=subscriptionVersion, current={id:subscription.id,manageToken:subscription.manageToken};
  let result;
  try { result = await api('GET',`/api/subscriptions/${encodeURIComponent(current.id)}`,undefined,current.manageToken); }
  catch(error) {if(version!==subscriptionVersion)return false;throw error;}
  if(version!==subscriptionVersion || current.id!==subscription?.id || current.manageToken!==subscription?.manageToken) return false;
  if (result.disabled) { acceptRemote(result); return true; }
  if (!force && dirty() && result.revision !== subscription.revision) {
    conflict = true; renderSaveState(); renderSubscription();
    return false;
  }
  acceptRemote(result,force);
  return true;
}
function trackWrite(operation) {
  pendingWrite=operation;
  const clear=()=>{if(pendingWrite===operation)pendingWrite=null;};
  operation.then(clear,clear);
  return operation;
}
function saveSubscription(create = false) {
  if (requestPending || managementRestoring) return pendingWrite || Promise.resolve();
  return trackWrite(performSaveSubscription(create));
}
async function performSaveSubscription(create) {
  if (conflict) { openSubscription(); showSubscriptionError({status:409}); return; }
  subscriptionVersion++;
  requestPending = true; entryError=false; renderSubscription(); $('#subscription-error').hidden = true;
  try {
    // Validate the complete feed before sending settings. DST changes use the
    // same compatible resolution policy as the subscription service.
    if (!create || !pendingCreation) exportICS(selectOccurrences(data,settings),{zone:settings.zone,name:'藏历'});
    if(create && !apiBaseUrl) throw new Error('暂时无法完成订阅，请稍后重试。你的选择已保留，也可以使用下方文件导入。');
    const attempt=create ? creationAttempt() : null;
    const submitted = clone(attempt ? attempt.settings : settings);
    const result = await api(create ? 'POST' : 'PATCH',create ? '/api/subscriptions' : `/api/subscriptions/${encodeURIComponent(subscription.id)}`,
      create ? {settings:submitted} : {settings:submitted,revision:subscription.revision},undefined,attempt?.key);
    if(create && (!/^[a-f0-9-]{36}$/.test(result.id) || !/^[A-Za-z0-9_-]{43}$/.test(result.manageToken) ||
        !Number.isSafeInteger(result.revision) || result.revision<1 || !result.settings || result.disabled)) {
      throw new Error('订阅服务返回的信息不完整。创建进度已保留，请重试恢复同一份订阅。');
    }
    const changedDuringSave = JSON.stringify(settings) !== JSON.stringify(submitted);
    const latestDraft = clone(settings);
    acceptRemote(result,true);
    if(create) {
      const saved=readStored(subscriptionKey);
      // Do not discard the recovery capability if saving the returned credentials
      // failed (for example, storage quota). Reload can still recover this feed.
      if(saved?.id===subscription.id && saved.manageToken===subscription.manageToken) {
        pendingCreation=null;storeCreationAttempt();
      }
    }
    if (changedDuringSave) {
      settings = latestDraft; refresh(); renderSubscription();
      notify('已保存上次提交的设置；后续修改仍待保存。');
    } else notify('设置已保存，等待日历同步');
  } catch (error) { showSubscriptionError(error); }
  finally {
    requestPending = false; renderSubscription();
    // Keep the next real click close to the user's focus after the disappearing
    // preparation control. Never launch a protocol from this async callback.
    if(create && subscription && $('#subscription-dialog').open &&
      (document.activeElement===$('#create-subscription') || document.activeElement===$('#subscription-dialog'))) {
      const next=['#iphone-subscribe','#copy-feed'].map(selector=>$(selector)).find(node=>!node.hidden&&!node.disabled&&!node.hasAttribute('aria-disabled'));
      next?.focus({preventScroll:true});
    }
  }
}
function stopSubscription() {
  if(requestPending || managementRestoring || !subscription) return;
  const current={id:subscription.id,manageToken:subscription.manageToken};
  subscriptionVersion++;
  requestPending=true; $('#confirm-stop').disabled=true; renderSubscription();
  return trackWrite((async()=>{
    try {
      await api('DELETE',`/api/subscriptions/${encodeURIComponent(current.id)}`,undefined,current.manageToken);
      clearSubscriptionError();
      subscription=null;conflict=false;stopped=true;persist();renderSubscription();
      $('#stop-confirmation').hidden=true;
      notify('已停用订阅。请在手机日历中移除这份订阅。');
    } catch(error) {showSubscriptionError(error);}
    finally {requestPending=false;$('#confirm-stop').disabled=false;renderSubscription();}
  })());
}
async function copy(value, label) {
  try { await navigator.clipboard.writeText(value); notify(`${label}已复制`); }
  catch {
    const input = document.createElement('textarea'); input.value = value;
    input.style.cssText = 'position:fixed;opacity:0'; document.body.append(input); input.select();
    let copied=false;
    try {copied=document.execCommand('copy');} catch {}
    input.remove();
    if (copied) notify(`${label}已复制`);
    else {
      const output = document.createElement('input'); output.value = value; output.readOnly = true; output.setAttribute('aria-label',label);
      $('#subscription-error').replaceChildren(document.createTextNode(`请手动复制${label}：`),output); $('#subscription-error').hidden = false; output.focus(); output.select();
    }
  }
}
function download(content, filename) {
  const url = URL.createObjectURL(new Blob([content],{type:'text/calendar;charset=utf-8'}));
  const link = document.createElement('a'); link.href = url; link.download = filename; document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url),60000);
}
function downloadCalendar(mode) {
  try {
    const events = upcoming.filter(event => event.preference.mode === mode);
    download(exportICS(events,{zone:settings.zone,name:mode === 'remind' ? '慧灯藏历 · 修行提醒' : '慧灯藏历 · 仅显示',sourceVersion:data.updatedOn}),`藏历-${mode === 'remind' ? '提醒' : '仅显示'}.ics`);
    $('#download-status').textContent = '已发起下载。请继续在日历应用中导入，并检查通知设置。';
  } catch (error) { $('#download-status').textContent = error.message; }
}
function attachEvents() {
  $('#preset-options').addEventListener('click',event=>{
    const button=event.target.closest('[data-preset]');if(!button)return;
    settings=applyPreset(settings,data.catalog,button.dataset.preset);lastActive.clear();stopped=false;
    refresh();$('#preset-options').querySelector(`[data-preset="${button.dataset.preset}"]`)?.focus({preventScroll:true});
  });
  $('#clear-selection').addEventListener('click',()=>{
    if(!countSelected())return;
    for(const [id,pref] of Object.entries(settings.events)) {
      if(pref.mode!=='off')lastActive.set(id,clone(pref));
      pref.mode='off';
    }
    stopped=false;refresh();
    if($('.workspace').dataset.activeTab==='preview' && matchMedia('(max-width:1023px)').matches) $('[data-cal-view="month"]').focus({preventScroll:true});
    else $('#preset-options button').focus({preventScroll:true});
    notify(subscription?'已清空选择；保存修改后更新订阅。':'已清空选择，可以重新挑选。');
  });
  const openZone=()=>zonePicker.open({zone:settings.zone,deviceZone:observedZone});
  $('#zone-settings').addEventListener('click',openZone);
  $('#keep-zone').addEventListener('click',()=>{ui.lastDeviceZone=observedZone;persistUI();renderRegion();});
  $('#use-device-zone').addEventListener('click',()=>{
    if(!resolveTimeZone(observedZone)){openZone();return;}
    settings.zone=observedZone;ui.lastDeviceZone=observedZone;persistUI();refresh(false);
    notify(subscription?'提醒时区已调整；点击保存修改后同步。':'已采用设备时区。');
  });
  window.addEventListener('focus',checkDeviceTime);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)checkDeviceTime();});
  window.addEventListener('hashchange',() => { void restoreManagementLink(); });
  $('#groups').addEventListener('change',event => {
    const id = event.target.dataset.event; if (!id) return;
    const pref = settings.events[id];
    if (event.target.checked) settings.events[id] = clone(lastActive.get(id) || {mode:'display',reminders:pref.reminders.length ? pref.reminders : defaultReminders()});
    else { lastActive.set(id,clone(pref)); pref.mode = 'off'; }
    stopped = false; refresh();
  });
  $('#groups').addEventListener('click',event => {
    const button = event.target.closest('button'); if (!button) return;
    const groupId = button.dataset.selectGroup || button.dataset.clearGroup || button.dataset.reminderGroup;
    if (groupId) {
      const items = data.catalog.events.filter(item => item.group === groupId);
      if (button.dataset.reminderGroup) { openReminders(items.map(item => item.id),data.catalog.groups.find(group => group.id === groupId).name,button); return; }
      for (const item of items) {
        const pref = settings.events[item.id];
        if (button.dataset.clearGroup) { if (pref.mode !== 'off') lastActive.set(item.id,clone(pref)); pref.mode = 'off'; }
        else if (pref.mode === 'off') settings.events[item.id] = clone(lastActive.get(item.id) || {mode:'display',reminders:pref.reminders.length ? pref.reminders : defaultReminders()});
      }
      stopped = false; refresh();
    } else if (button.dataset.reminderEvent) {
      const item = data.catalog.events.find(item => item.id === button.dataset.reminderEvent);
      openReminders([item.id],item.title,button);
    }
  });
  const allReminders = event => openReminders(data.catalog.events.map(event => event.id),'已选日程',event.currentTarget);
  $('#reminder-settings').addEventListener('click',allReminders);
  $('#reminder-dialog').addEventListener('change',event => {
    if (event.target.name === 'reminder-mode') { reminderDraft.mode = event.target.value; renderReminderFields(); }
    const field = event.target.dataset.reminderField;
    if (field) reminderDraft.reminders[+event.target.dataset.reminderIndex][field] = field === 'time' ? event.target.value : +event.target.value;
  });
  $('#reminder-fields').addEventListener('click',event => {
    if (event.target.closest('#add-reminder')) { reminderDraft.reminders.push({daysBefore:1,time:'20:00'}); renderReminderFields(); $('[data-reminder-index="1"][data-reminder-field="time"]').focus(); }
    const remove = event.target.closest('[data-remove-reminder]');
    if (remove && reminderDraft.reminders.length > 1) { reminderDraft.reminders.splice(+remove.dataset.removeReminder,1); renderReminderFields(); $('[data-reminder-index="0"][data-reminder-field="time"]').focus(); }
  });
  $('#reminder-form').addEventListener('submit',event => {
    event.preventDefault();
    if (!event.target.reportValidity()) return;
    for (const id of reminderTarget) settings.events[id] = clone(reminderDraft);
    stopped = false;
    refresh(); $('#reminder-dialog').close();
  });
  document.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click',() => document.getElementById(button.dataset.close).close()));
  $('#reminder-dialog').addEventListener('close',()=>{
    if(reminderReturnSelector && !document.querySelector('dialog[open]')) $(reminderReturnSelector)?.focus({preventScroll:true});
  });
  createMobileTabs();
  $('.skip').addEventListener('click',event=>{event.preventDefault();$('#tab-selection').click();$('#preset-options button')?.focus();});
  $('#my-subscription').addEventListener('click',()=>openSubscription());
  $('#subscribe').addEventListener('click',() => openSubscription({prepare:true}));
  $('#create-subscription').addEventListener('click',()=>prepareSubscription({retry:true}));
  $('#restart-creation').addEventListener('click',()=>{
    if(requestPending||managementRestoring||subscription||!creationBlocked)return;
    // Only this explicit action abandons an unrecoverable attempt. Ordinary
    // network failures keep the nonce, even if the user changes their draft.
    pendingCreation=null;storeCreationAttempt();clearSubscriptionError();
    void prepareSubscription({retry:true});
  });
  $('#save-subscription').addEventListener('click',() => saveSubscription());
  $('#reload-subscription').addEventListener('click',async() => {
    try { if(await loadSubscription(true)){ $('#subscription-error').hidden = true; notify('已载入最新设置'); } }
    catch (error) { showSubscriptionError(error); }
  });
  document.querySelectorAll('input[name="device"]').forEach(input => input.addEventListener('change',()=>{ui.app=input.value;persistUI();$('#entry-attempt').hidden=true;deviceGuide();void prepareSubscription();}));
  $('#copy-feed').addEventListener('click',() => {if(subscription && !requestPending && !managementRestoring && !dirty() && !conflict) void copy(subscription.feedUrl,'订阅地址');});
  for(const selector of ['#iphone-subscribe','#google-subscribe']) $(selector).addEventListener('click',event=>{
    if(!subscription || requestPending || managementRestoring || dirty() || conflict || !event.currentTarget.hasAttribute('href')) {event.preventDefault();return;}
    // No success signal: only the user can confirm seeing the events.
    $('#entry-attempt').hidden=false;
    $('#entry-attempt').textContent=selector==='#iphone-subscribe' ? '请在日历中确认添加。若没有打开，可查看下方帮助或复制订阅地址。' : '请在 Google 日历网页中粘贴订阅地址并确认添加。';
  });
  $('#copy-management').addEventListener('click',() => {
    const url = new URL(location.href); url.hash = `manage=${subscription.id}.${subscription.manageToken}`;
    copy(url.href,'管理链接');
  });
  $('#stop-subscription').addEventListener('click',() => { $('#stop-confirmation').hidden = false; });
  $('#cancel-stop').addEventListener('click',() => { $('#stop-confirmation').hidden = true; });
  $('#confirm-stop').addEventListener('click',stopSubscription);
  $('#downloads').addEventListener('click',event => { const button = event.target.closest('[data-download]'); if (button) downloadCalendar(button.dataset.download); });
}
function downloadReminderTest() {
  try {
    if(!settings.zone)throw new Error('请先选择提醒时区。');
    const {at,content}=reminderTestICS();
    download(content,'藏历-提醒测试.ics');
    const time=wallTimeInZone(at,settings.zone).replace('T',' ');
    guide.setTestStatus(`请在${time}（${zoneLabel()}）前导入。收到通知后可删除测试日程；这个测试不代表订阅更新已经通过检查。`);
  } catch(error) {guide.setTestStatus(error.message);}
}
async function restoreManagementLink() {
  const manage = new URLSearchParams(location.hash.slice(1)).get('manage');
  if (manage === null) return;
  const attempt = ++managementAttempt;
  subscriptionVersion++;
  managementRestoring=false;
  // Remove the management capability before making any request. A fragment-only
  // navigation must work as well as opening the link in a new browser tab.
  try { history.replaceState(null,'',location.pathname+location.search); } catch {}
  openSubscription();
  const dot = manage.indexOf('.');
  if (dot <= 0 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(manage)) {
    showSubscriptionError(new Error('管理链接不完整，请重新复制完整链接。原有设置已保留。'));
    return;
  }
  const candidate = {id:manage.slice(0,dot),manageToken:manage.slice(dot+1)};
  managementRestoring=true; renderSubscription();
  try {
    // Finish an already-authorized write before adopting another capability.
    // Otherwise a late PATCH (without a token in its response) could combine
    // subscription A's id with subscription B's management token.
    if(pendingWrite) await pendingWrite;
    if(attempt!==managementAttempt) return;
    const result = await api('GET',`/api/subscriptions/${encodeURIComponent(candidate.id)}`,undefined,candidate.manageToken);
    if (attempt !== managementAttempt) return;
    if (result.disabled) throw new Error('此管理链接对应的订阅已停用。原有设置已保留。');
    if (!safeHTTP(result.feedUrl)) throw new Error('此管理链接无法读取有效的订阅地址。原有设置已保留。');
    subscription = {...candidate,savedSettings:clone(settings)};
    acceptRemote(result,true);
  } catch (error) { if (attempt === managementAttempt) showSubscriptionError(error); }
  finally { if(attempt===managementAttempt) {managementRestoring=false;renderSubscription();} }
}
async function init() {
  fillIcons();
  const embedded = $('#calendar-inline-data');
  if (embedded) data = JSON.parse(embedded.textContent);
  else {
    const response = await fetch('./calendar-data.json',{cache:'no-cache'});
    if (!response.ok) throw new Error('日期资料暂时无法读取，请刷新后重试。');
    data = await response.json();
  }
  if (location.protocol !== 'file:') {
    try {
      const embeddedConfig = $('#calendar-inline-config');
      const config = embeddedConfig ? JSON.parse(embeddedConfig.textContent) : await (await fetch('./config.json',{cache:'no-cache'})).json();
      apiBaseUrl = safeHTTP(config.apiBaseUrl).replace(/\/$/,'');
    } catch {}
  }
  observedZone=deviceTimeZone();today=deviceDate();
  const savedUI=readStored(uiKey);ui=savedUI&&typeof savedUI==='object'&&!Array.isArray(savedUI)?savedUI:{};
  if(!ui.lastDeviceZone&&observedZone)ui.lastDeviceZone=observedZone;
  const stored = readStored(storageKey) || readStored('huideng.calendar.v1');
  settings = stored ? normalizeSettings(stored,data.catalog) : defaults(data.catalog,observedZone);
  const credentials = readStored(subscriptionKey);
  if (credentials?.id && credentials.manageToken && credentials.savedSettings && safeHTTP(credentials.feedUrl)) {
    subscription = {...credentials,feedUrl:safeHTTP(credentials.feedUrl),savedSettings:normalizeSettings(credentials.savedSettings,data.catalog)};
  }
  const storedCreation=readStored(creationKey);
  if(!subscription && storedCreation?.apiBaseUrl===apiBaseUrl && /^[A-Za-z0-9_-]{43}$/.test(storedCreation.key) &&
      storedCreation.settings && typeof storedCreation.settings==='object' && !Array.isArray(storedCreation.settings)) pendingCreation=storedCreation;
  zonePicker=createZonePicker($('#zone-dialog'),{onApply:zone=>{
    settings.zone=zone;stopped=false;ui.lastDeviceZone=observedZone;persistUI();refresh(false);
    notify(subscription?'提醒地区已调整；点击保存修改后同步。':'提醒地区已调整。');
  }});
  calendarView=createCalendarView($('#calendar-preview'),{initialView:ui.view==='list'?'list':'month',today,
    onViewChange:view=>{ui.view=view;persistUI();},
    onEditEvent:(id,trigger)=>{const item=data.catalog.events.find(event=>event.id===id);if(item)openReminders([id],item.title,trigger);}});
  guide=createSubscriptionGuide($('#device-guide'),{notificationRoot:$('#notification-guide'),initialState:ui.guide,
    onStateChange:state=>{ui.guide=state;persistUI();},onTestReminder:downloadReminderTest});
  const savedApp=['iphone','google','other'].includes(ui.app) ? ui.app : ui.guide?.app;
  if(['iphone','google','other'].includes(savedApp)) $(`input[name="device"][value="${savedApp}"]`).checked=true;
  attachEvents(); $('#app').hidden = false; renderGroups(); renderPresets();renderPreview(); persist();persistUI();checkDeviceTime();
  if(pendingCreation?.blocked) showSubscriptionError(pendingCreation.blocked);
  // Reuse the browser's completed layout. Writing a root variable between two
  // bounding-box reads forced the whole document to lay out twice on startup.
  const actionBar=$('.action-bar'), previewColumn=$('.preview-column');
  let barHeight=86, previewHeight=Infinity;
  const resizeLayout=()=>{
    const value=`${barHeight}px`;
    if(document.documentElement.style.getPropertyValue('--action-height')!==value)
      document.documentElement.style.setProperty('--action-height',value);
    previewColumn.classList.toggle('can-stick',previewHeight<innerHeight-barHeight-40);
  };
  if(window.ResizeObserver){
    const observer=new ResizeObserver(entries=>{
      for(const entry of entries){
        const height=entry.borderBoxSize?.[0]?.blockSize ?? entry.target.getBoundingClientRect().height;
        if(entry.target===actionBar)barHeight=height;else previewHeight=height;
      }
      resizeLayout();
    });
    observer.observe(actionBar);observer.observe(previewColumn);
    window.addEventListener('resize',resizeLayout);
  }else{
    const measureLayout=()=>{barHeight=actionBar.getBoundingClientRect().height;previewHeight=previewColumn.getBoundingClientRect().height;resizeLayout();};
    window.addEventListener('resize',measureLayout);requestAnimationFrame(measureLayout);
  }
  const resizeDialogs=()=>{
    document.documentElement.style.setProperty('--available-height',`${window.visualViewport?.height||innerHeight}px`);
    document.documentElement.style.setProperty('--viewport-top',`${window.visualViewport?.offsetTop||0}px`);
  };
  window.visualViewport?.addEventListener('resize',resizeDialogs);
  window.visualViewport?.addEventListener('scroll',resizeDialogs);
  window.addEventListener('resize',resizeDialogs);resizeDialogs();
  if (new URLSearchParams(location.hash.slice(1)).has('manage')) await restoreManagementLink();
  else if (subscription && apiBaseUrl) {
    try { await loadSubscription(); }
    catch (error) { notify(error.message); }
  }
  if(!settings.zone&&!document.querySelector('dialog[open]'))zonePicker.open({zone:'',deviceZone:observedZone});
}
init().catch(error => {
  $('#load-error').textContent = error.message || '页面暂时无法加载，请刷新重试。';
  $('#load-error').hidden = false;
});
