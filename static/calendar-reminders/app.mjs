import {defaults, normalizeSettings, selectOccurrences, selectCalendarOccurrences, exportICS, reminderLabel, addDays, rangeEnd} from './core.mjs';
import {getTibetanDate,generateOccurrences} from './engine.mjs';
import {icon, fillIcons} from './icons.mjs';
import {deviceTimeZone,resolveTimeZone,zoneInfo} from './timezones.mjs';
import {deviceDate,nextLocalMidnight,changedDeviceZone} from './device-time.mjs';
import {createZonePicker} from './zone-picker.mjs';
import {createCalendarView} from './calendar-view.mjs';
import {createSubscriptionGuide} from './subscription-guide.mjs';
import {PRESETS,presetIds,applyPreset,matchingPreset} from './presets.mjs';
import {timeComparison} from './time-comparison.mjs';
import {eventPresentation,eventIcon,eventDateHint} from './event-presentation.mjs';
import {calendarEnvironment,appleSubscriptionUrl,GOOGLE_ADD_URL,OUTLOOK_URL} from './calendar-entry.mjs';
import {checkSubscriptionConnection} from './connection-check.mjs';
import {cloneSettings as clone,fetchJSON} from './runtime.mjs';
import {createMobileTabs} from './mobile-tabs.mjs';
import {playMotion,playSymbol,installDisclosureMotion} from './motion.mjs';
import qrcode from './vendor/qrcode/qrcode.mjs';

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
let connection = {state:'idle'}, connectionController = null, lastWriteKind = '';
let downloadCache = {key:'',events:[]};
const calendarDevice = calendarEnvironment();
const countSelected = () => Object.values(settings.events).filter(pref => pref.mode !== 'off').length;
const hasSelectedContent = () => countSelected() > 0 || settings.includeDailyDates === true;
const selectionSummary = () => !countSelected() && settings.includeDailyDates ? '每日藏历 · 仅显示' : `已选 ${countSelected()} 项${settings.includeDailyDates ? ' · 含每日藏历' : ''}`;
const dirty = () => Boolean(subscription && JSON.stringify(settings) !== JSON.stringify(subscription.savedSettings));
const zoneLabel = () => settings.zone ? zoneInfo(settings.zone)?.label || settings.zone : '尚未选择时区';
const currentApp = () => $('input[name="device"]:checked')?.value || '';
const hasReminders = () => Object.values(settings.events).some(pref=>pref.mode==='remind');
function persistUI() { try {localStorage.setItem(uiKey,JSON.stringify(ui));} catch {} }

// An optional undo keeps one-tap clearing safe for anyone who taps by mistake.
function notify(message, undo) {
  // A toast is a short note, not a sentence: no full stop at the end, and
  // a second clause joins with a comma.
  const toast=$('#toast'); toast.textContent = String(message).replace(/[。.]+$/,'').replace(/。/g,'，'); toast.hidden = false;
  if(undo){
    const button=document.createElement('button'); button.type='button'; button.className='toast-undo'; button.textContent='撤销';
    button.addEventListener('click',()=>{toast.hidden=true;clearTimeout(notify.timer);undo();},{once:true});
    toast.append(button);
  }
  clearTimeout(notify.timer); notify.timer = setTimeout(() => { toast.hidden = true; }, undo ? 7000 : 4000);
}
function restoreSnapshot(snapshot, message) {
  settings=clone(snapshot);stopped=false;refresh();notify(message);
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
  try { const tibetan=getTibetanDate(today); $('#today-tibetan').textContent = `藏历${tibetan.yearName}年 ${tibetan.display}`; }
  catch { $('#today-tibetan').textContent = ''; }
  renderNextPractice();
}
// Read-only orientation for every visitor: the next guru or dakini tsok day,
// computed from the same PRO rules as the feed. It never changes selections.
let nextPracticeDay = '';
function renderNextPractice() {
  const node = $('#next-practice');
  if (!node || !data?.catalog || nextPracticeDay === today) return;
  nextPracticeDay = today;
  const run = () => {
    try {
      const events = data.catalog.events.filter(event => ['guru-tsok','dakini-tsok'].includes(event.id));
      const next = generateOccurrences({catalog:{...data.catalog,events},published:{records:[],coverage:null}},{start:today,end:addDays(today,40)})
        .sort((a,b) => a.date.localeCompare(b.date))[0];
      if (!next) { node.hidden = true; return; }
      const days = Math.round((Date.parse(next.date) - Date.parse(today)) / 864e5), [, month, day] = next.date.split('-').map(Number);
      const when = days === 0 ? '今天' : `${month}月${day}日 · ${days === 1 ? '明天' : `还有 ${days} 天`}`;
      node.innerHTML = `${icon('knot')}<small>${days === 0 ? '今日荟供' : '下一个荟供日'}</small><strong>${esc(next.title)}<span>${esc(when)}</span></strong>`;
      node.hidden = false;
    } catch { node.hidden = true; }
  };
  // Deferred so the first paint and the cold-start task stay unchanged.
  if (typeof requestIdleCallback === 'function') requestIdleCallback(run, {timeout: 1500}); else setTimeout(run, 300);
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
  if (today!==previousToday) renderDateHints();
  if (today!==previousToday || observedZone!==previousZone) renderPreview();
  clearTimeout(dayTimer); dayTimer=setTimeout(checkDeviceTime,Math.min(nextLocalMidnight(),60000-Date.now()%60000+50));
}
function renderPresets() {
  const current=matchingPreset(settings,data.catalog);
  // The plan above and the categories below are one choice at two levels of
  // detail: say which plan filled them, or that they are now hand-picked.
  const plan=PRESETS.find(preset=>preset.id===current);
  $('#category-source').textContent=plan ? `下面已按“${plan.title}”勾选；在这里改动后，就变成自选`
    : countSelected() ? '自选：已在下面逐项调整，上方方案不再选中' : '';
  $('#preset-options').innerHTML=PRESETS.map(preset=>`<button class="preset-card" type="button" data-preset="${preset.id}" aria-pressed="${current===preset.id}"${preset.id==='practice'?' aria-describedby="preset-scope-note"':''}><span class="preset-icon">${icon(preset.icon)}</span><span class="preset-copy"><strong>${preset.title}<small>${presetIds(data.catalog,preset.id).length} 项</small></strong><span>${preset.description}</span><em>${icon('bell')}${preset.reminder}</em></span><span class="preset-check" aria-hidden="true">${current===preset.id?icon('check'):''}</span></button>`).join('');
  $('#clear-selection').disabled=!hasSelectedContent();
  $('#include-daily-dates').checked=settings.includeDailyDates===true;
}
function renderGroups() {
  renderToday();
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
        return `<div class="event-row ${eventPresentation(event,data.catalog).colorClass}"><label class="event-label"><input type="checkbox" data-event="${esc(event.id)}" id="event-${esc(event.id)}" ${active ? 'checked' : ''}><span><span class="event-title">${esc(event.title)}</span><span class="event-rule" data-date-hint="${esc(event.id)}">${esc(eventDateHint(event,data,today))}</span></span></label><button type="button" class="event-reminder ${pref.mode === 'remind' ? 'active' : ''}" data-reminder-event="${esc(event.id)}" aria-label="${esc(event.title)}的提醒设置" ${!active ? 'disabled' : ''}>${icon(pref.mode === 'remind' ? 'bell' : 'bell-off')}<span>${esc(label)}</span></button></div>`;
      }).join('')}</div></details>`;
  }).join('');
}
function renderDateHints() {
  for (const node of document.querySelectorAll('[data-date-hint]')) {
    const event=data.catalog.events.find(event=>event.id===node.dataset.dateHint);
    if (event) node.textContent=eventDateHint(event,data,today);
  }
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
  renderTimeChoices(); renderQuickAdd();
  renderRegion(); renderSaveState();
}
// Step 2: one reminder time for every day that reminds. Detailed per-item
// times stay possible; the step then says so instead of overwriting silently.
function remindPrefs() { return Object.values(settings.events).filter(pref=>pref.mode==='remind'); }
function renderTimeChoices() {
  const prefs=remindPrefs(), keys=new Set(prefs.map(pref=>pref.reminders.map(r=>`${r.daysBefore}|${r.time}`).join(',')));
  const current=keys.size===1 ? [...keys][0] : '';
  for(const button of document.querySelectorAll('[data-time-choice]')) {
    button.disabled=!prefs.length;
    button.setAttribute('aria-pressed',String(button.dataset.timeChoice===current));
  }
  $('#time-choice-note').textContent=!prefs.length ? '先在上一步选择会提醒的日子' : !current ? '已逐项设置不同时间' :
    [...document.querySelectorAll('[data-time-choice]')].some(b=>b.dataset.timeChoice===current) ? '' : `当前：${reminderLabel(prefs[0].reminders)}`;
}
// Step 3 names the device it recognised. A browser that reports a computer but
// behaves like a phone (touch, narrow screen, e.g. a "desktop site" toggle) is
// treated as a phone: phone readers never see computer instructions.
const phoneLike=()=>calendarDevice.mobile || matchMedia('(pointer:coarse) and (max-width:767px)').matches;
const deviceLabel=()=>calendarDevice.appleMobile ? '加入 iPhone 日历' : calendarDevice.mac ? '加入 Mac 日历' :
  calendarDevice.android ? '加入手机日历' : phoneLike() ? '加入手机日历' : '加入我的日历';
function renderQuickAdd() {
  const phone=phoneLike();
  $('#add-title-text').textContent=phone ? '加入手机日历' : '加入日历';
  $('#step-add-device').textContent=subscription
    ? (phone ? '已经加入过。以后改了选择，点底部“保存修改”，手机日历会自动更新，不用重新添加。' : '已经加入过。以后改了选择，点底部“保存修改”，日历会自动更新，不用重新添加。')
    : calendarDevice.appleMobile ? '点底部按钮，iPhone 会问是否订阅这个日历，点“订阅”即可。'
    : phone ? '点底部按钮，按提示把它加到手机自带的日历里。'
    : calendarDevice.mac ? '可以直接加入 Mac 日历，也可以选 Google 或 Outlook。'
    : '可以直接加入 Google 或 Outlook 日历；要加到手机上，用下方扫码。';
  $('#step-add-note').textContent=subscription ? '' : '只需添加一次。已经加过的不用再加；如果日历里同一天出现两遍，删掉其中一个日历即可。';
  $('#step-add-note').hidden=Boolean(subscription);
  $('#share-settings').lastChild.textContent=phone ? '把这套设置分享给师兄' : '用手机扫码继续 · 分享给师兄';
  renderSubscribedCard();
}
function nextReminderText() {
  const next=upcoming.find(event=>event.preference?.mode==='remind') || upcoming.find(event=>event.kind!=='daily-date');
  if(!next) return '目前没有即将到来的修行日';
  const [, month, day]=next.date.split('-').map(Number);
  return next.preference?.mode==='remind' ? `下一次提醒：${month}月${day}日 ${next.title} · ${reminderLabel(next.preference.reminders)}` : `下一个修行日：${month}月${day}日 ${next.title}（仅显示）`;
}
function renderSubscribedCard() {
  const card=$('#subscribed-card'), show=Boolean(subscription) && !stopped && !conflict && !dirty();
  card.hidden=!show; if(!show)return;
  // A web page cannot open the phone's settings, so give the one path that
  // works on every phone: search the Settings app for the calendar.
  $('#subscribed-hint').textContent=phoneLike()
    ? '到时没有响铃？打开手机“设置”，搜索“日历”，确认已允许通知。改了设置后，手机日历通常几小时内更新。'
    : '没有收到提醒？在日历应用的设置里确认已允许通知。改了设置后，日历通常几小时内更新。';
  const next=upcoming.find(event=>event.preference?.mode==='remind') || upcoming.find(event=>event.kind!=='daily-date');
  if(!next){$('#subscribed-next').textContent='目前没有即将到来的修行日。';return;}
  const [, month, day]=next.date.split('-').map(Number);
  $('#subscribed-next').textContent=next.preference?.mode==='remind'
    ? `下一次提醒：${month}月${day}日 ${next.title} · ${reminderLabel(next.preference.reminders)}`
    : `下一个修行日：${month}月${day}日 ${next.title}（仅显示）`;
}
// The bottom bar always says what happens next, in the person's own terms.
// The bar speaks only when it has something to say: what to do first, or
// that nothing will ring. Times can differ per day, so none is repeated here;
// they are in step 2 and on each day.
function nextStepText() {
  if(!hasSelectedContent()) return '第 1 步：选择要提醒的日子';
  return remindPrefs().length ? '' : '只显示日期，不响铃';
}
// A share link carries the preset, the shared reminder time, the everyday
// layer and the title style. Per-item fine tuning stays with its owner.
function shareURL() {
  const url=new URL(location.href); url.hash=''; url.search='';
  const preset=matchingPreset(settings,data.catalog), times=new Set(remindPrefs().map(p=>p.reminders.map(r=>`${r.daysBefore}-${r.time.replace(':','')}`).join('_')));
  if(preset) url.searchParams.set('p',preset);
  if(times.size===1 && !/_/.test([...times][0])) url.searchParams.set('t',[...times][0]);
  if(settings.includeDailyDates) url.searchParams.set('d','1');
  if(settings.titleMarks) url.searchParams.set('m',settings.titleMarks);
  return {href:url.href,preset,custom:!preset || times.size>1};
}
function openShare() {
  const {href,preset,custom}=shareURL();
  const presetTitle=PRESETS.find(item=>item.id===preset)?.title || '自选的修行日';
  const prefs=remindPrefs();
  $('#share-summary').textContent=`${presetTitle}${prefs.length?` · 提醒：${reminderLabel(prefs[0].reminders)}`:''}${settings.includeDailyDates?' · 含每日藏历':''}`;
  $('#share-custom-note').hidden=!custom;
  try { const qr=qrcode(0,'M'); qr.addData(href); qr.make(); $('#share-qr').innerHTML=qr.createSvgTag({cellSize:4,margin:2,scalable:true}); }
  catch { $('#share-qr').textContent='链接过长，无法生成二维码，请复制链接。'; }
  $('#share-copy').onclick=()=>void copy(href,'分享链接');
  $('#share-dialog').showModal();
}
function applySharedSettings() {
  const params=new URLSearchParams(location.search);
  if(![...params.keys()].some(key=>['p','t','d','m'].includes(key)))return '';
  const clean=new URL(location.href); for(const key of ['p','t','d','m']) clean.searchParams.delete(key);
  try{history.replaceState(history.state,'',clean.href);}catch{}
  if(subscription) return '你已有自己的订阅，分享链接的设置没有自动套用；可在下方修改后保存。';
  let next=clone(settings);
  if(PRESETS.some(item=>item.id===params.get('p'))) next=applyPreset(next,data.catalog,params.get('p'));
  const time=params.get('t')?.match(/^([0-7])-([01]\d|2[0-3])([0-5]\d)$/);
  if(time) for(const pref of Object.values(next.events)) if(pref.mode==='remind') pref.reminders=[{daysBefore:Number(time[1]),time:`${time[2]}:${time[3]}`}];
  if(params.get('d')==='1') next.includeDailyDates=true;
  // Two styles are offered: none (default) or symbols. Anything else falls
  // back to none.
  if(params.get('m')==='symbols') next.titleMarks='symbols'; else delete next.titleMarks;
  settings=next;
  return '已按分享的设置选好，确认后点底部按钮加入日历。';
}
function renderSaveState() {
  const changed = dirty(), count = countSelected();
  const dailyOnly=settings.includeDailyDates && !count;
  $('#selection-count').textContent = dailyOnly ? '每日藏历' : `已选 ${count} 项`;
  $('#reminder-count').textContent = dailyOnly ? '仅显示' : `${Object.values(settings.events).filter(pref=>pref.mode==='remind').length} 项提醒`;
  $('#daily-date-count').hidden=!settings.includeDailyDates || !count;
  $('#subscribe').setAttribute('aria-busy',String(requestPending||managementRestoring));
  $('#save-state').textContent = stopped ? '已停用，请在手机移除订阅日历' : conflict ? '设置已在其他设备修改' : changed ? '有改动，保存后同步到日历' : subscription ? '已同步到日历，改动会自动更新' : nextStepText();
  $('#unsaved-dot').hidden = !changed;
  $('#subscribe-label').textContent = managementRestoring ? '正在恢复订阅…' : requestPending ? '正在保存…' : subscription ? (changed ? '保存修改' : '我的订阅') : deviceLabel();
  for(const input of document.querySelectorAll('input[name="title-marks"]')) input.checked=input.value===(settings.titleMarks||'none');
  const ctaDisabled = requestPending || managementRestoring || (!subscription && !hasSelectedContent());
  // The first time the main button becomes usable, it gives one gentle pulse
  // so the eye finds the next step. Not on load, not on later changes.
  if(renderSaveState.wasDisabled===true && !ctaDisabled && !subscription && !renderSaveState.nudged){renderSaveState.nudged=true;requestAnimationFrame(()=>playMotion($('#subscribe'),'nudge'));}
  renderSaveState.wasDisabled=ctaDisabled;
  $('#subscribe').disabled = ctaDisabled;
  // With a saved subscription and nothing to save, the bottom button becomes
  // a quiet "我的订阅": the thumb-reachable way back to the manage panel.
  $('#subscribe').classList.toggle('is-quiet', Boolean(subscription) && !changed && !requestPending && !managementRestoring && !conflict && !stopped);
  // This opens the existing panel only. Keep it available while saving so a
  // user who closed the panel can return to progress, help or a failure state.
  $('#my-subscription').disabled = false;
  if (data) renderQuickAdd();
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
  $('#reminder-fields').innerHTML = reminderDraft.reminders.map((reminder,index) => `<div class="reminder-row${reminderDraft.reminders.length === 1 ? ' is-single' : ''}"><label>${reminderDraft.reminders.length === 1 ? '提醒日期' : `第 ${index+1} 次提醒`}<select data-reminder-index="${index}" data-reminder-field="daysBefore" aria-label="第${index+1}次提醒日期" ${!enabled ? 'disabled' : ''}>${[[0,'当天'],[1,'提前一天'],[2,'提前两天'],[7,'提前一周']].map(([value,label]) => `<option value="${value}" ${reminder.daysBefore === value ? 'selected' : ''}>${label}</option>`).join('')}</select></label><label>具体时间<input type="time" required value="${esc(reminder.time)}" data-reminder-index="${index}" data-reminder-field="time" aria-label="第${index+1}次提醒时间" ${!enabled ? 'disabled' : ''}></label>${reminderDraft.reminders.length === 1 ? '' : `<button type="button" class="icon-button" data-remove-reminder="${index}" aria-label="删除第${index+1}次提醒">${icon('close')}</button>`}</div>`).join('') + (reminderDraft.reminders.length < 2 ? `<button type="button" class="text-button" id="add-reminder">${icon('plus')}再加一次提醒</button>` : '');
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
  const inAppApple=app==='iphone' && calendarDevice.apple && Boolean(calendarDevice.inAppBrowser);
  const appleUrl=appleSubscriptionUrl(subscription?.feedUrl);
  const ready=Boolean(subscription && !requestPending && !managementRestoring && !dirty() && !conflict);
  guide?.update({app,hasReminders:hasReminders(),hasSubscription:Boolean(subscription),preparing:requestPending||managementRestoring,entryReady:ready});
  const apple=$('#iphone-subscribe');
  apple.hidden = app !== 'iphone' || !calendarDevice.apple || !appleUrl || inAppApple;
  if(ready) apple.removeAttribute('aria-disabled'); else apple.setAttribute('aria-disabled','true');
  apple.tabIndex=ready ? 0 : -1;
  if(ready && appleUrl && !inAppApple) apple.href=appleUrl; else apple.removeAttribute('href');
  $('#apple-browser-notice').hidden=!inAppApple;
  $('#apple-browser-title').textContent='请先在浏览器中打开';
  $('#apple-browser-message').textContent=inAppApple ? `当前在${calendarDevice.inAppBrowser}中，日历跳转可能被拦截。请点右上角“…”菜单，选择“在浏览器中打开”或“在 Safari 中打开”。` : '';
  const google=$('#google-subscribe');
  google.hidden=app!=='google'||calendarDevice.mobile||!subscription;
  if(ready) google.removeAttribute('aria-disabled'); else google.setAttribute('aria-disabled','true');
  google.tabIndex=ready ? 0 : -1;
  if(ready) google.href=GOOGLE_ADD_URL; else google.removeAttribute('href');
  const outlook=$('#outlook-subscribe');
  outlook.hidden=app!=='outlook'||calendarDevice.mobile||!subscription;
  outlook.tabIndex=ready ? 0 : -1;
  if(ready) {outlook.href=OUTLOOK_URL;outlook.removeAttribute('aria-disabled');}
  else {outlook.removeAttribute('href');outlook.setAttribute('aria-disabled','true');}
  $('#copy-feed').disabled=!ready;
  const manualEntry=['google','outlook'].includes(app)&&!calendarDevice.mobile;
  $('#copy-feed').classList.toggle('primary',app==='other'||['google','outlook'].includes(app)||app==='iphone'&&(!calendarDevice.apple||inAppApple));
  $('#copy-feed').classList.toggle('secondary',!$('#copy-feed').classList.contains('primary'));
  $('#copy-feed').dataset.step=manualEntry?'1':'';
  google.dataset.step=manualEntry&&app==='google'?'2':'';
  outlook.dataset.step=manualEntry&&app==='outlook'?'2':'';
  const copied=$('#copy-progress');
  copied.hidden=!manualEntry||!ready||copied.dataset.app!==app||copied.dataset.feed!==subscription?.feedUrl;
  $('#entry-hint').textContent=managementRestoring ? '正在恢复订阅，请稍候。' : !app ? '' : requestPending ? '正在保存你的选择，请稍候。' : !subscription ? '选好日历应用后，我们会准备你的订阅。' : !ready ? '先保存修改，再继续添加到日历。' : inAppApple ? '也可复制上方的 HTTPS 订阅地址，在 Apple 日历中手动添加。复制后仍需到日历中确认。' : app==='iphone' ? calendarDevice.apple ? '将在系统日历中打开订阅确认，请按提示添加。' : '请把订阅地址传到你的 iPhone、iPad 或 Mac 上添加。' : app==='google' ? calendarDevice.mobile ? '请将订阅地址传到电脑，在 Google 日历网页中添加。' : '先复制订阅地址，再打开 Google 日历的“通过网址添加”页面。' : '应用有网址订阅入口时可粘贴此地址；否则请查看下方文件导入方式。';
  if(app==='outlook') $('#entry-hint').textContent=ready ? '先复制订阅地址，在 Outlook 网页版选择“添加日历 → 从 Web 订阅”；也可查看经典桌面版步骤。' : $('#entry-hint').textContent;
  if(inAppApple && !subscription) $('#entry-hint').textContent='请先在 Safari 或系统浏览器打开本页，再选择内容并准备订阅。微信与浏览器的本机草稿不会自动同步。';
  $('#create-subscription').hidden=inAppApple && !subscription;
  $('#copy-page').hidden=!inAppApple;
  $('#create-subscription').disabled = !app || !hasSelectedContent() || requestPending || managementRestoring || !settings.zone || creationBlocked;
  $('#create-subscription-label').textContent=managementRestoring ? '正在恢复订阅…' : requestPending ? '正在准备订阅…' : entryError ? '重试准备订阅' : app ? '继续订阅' : '请先选择日历应用';
  $('#subscription-new').setAttribute('aria-busy',String(requestPending||managementRestoring));
  $('#restart-creation').hidden=Boolean(subscription)||!creationBlocked||inAppApple;
  $('#restart-creation').disabled=requestPending||managementRestoring;
}
function resetConnection() {
  connectionController?.abort(); connectionController=null; connection={state:'idle'};
}
function renderConnection() {
  const busy=requestPending||managementRestoring;
  const title=busy ? (managementRestoring ? '正在恢复订阅' : subscription ? '正在保存设置' : '正在准备订阅') : stopped ? '已停用' :
    !subscription ? '尚未准备' : lastWriteKind==='saved' ? '设置已保存，等待日历同步' : '地址已生成';
  $('#connection-title').textContent=title;
  const checking=connection.state==='checking';
  const connectionPanel=$('#connection-status');
  const failed=connection.state==='error';
  // Make failures visible once; later re-renders respect the user's disclosure.
  if(failed && connectionPanel.dataset.state!=='error') $('#connection-details').open=true;
  connectionPanel.dataset.state=connection.state;
  // Before anything is prepared there is no connection to describe; keep the panel out of the way.
  connectionPanel.dataset.prepared=String(Boolean(subscription||busy||stopped));
  $('#connection-details-label').textContent=checking ? '正在检查' : failed ? '连接失败' : connection.state==='ok' ? '连接正常' : '连接信息';
  $('#connection-status').setAttribute('aria-busy',String(checking||busy));
  $('#connection-symbol').innerHTML=icon(stopped?'bell-off':connection.state==='ok'?'check':connection.state==='error'?'globe':'calendar');
  $('#connection-result').textContent=stopped ? '请在日历应用中移除这份订阅。' : !subscription ? '选择日历应用后，按步骤准备订阅。' : checking ? '正在检查服务与日历内容…' :
    connection.state==='ok' ? '本次连接检查正常' : connection.state==='error' ? '本次连接检查失败' : '可直接添加到日历，也可检查当前网络连接。';
  $('#connection-note').textContent=busy ? '你的选择会保留，请稍候。' : connection.message || '';
  $('#connection-time').textContent=connection.checkedAt ? `检查时间：${new Intl.DateTimeFormat('zh-CN',{hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(new Date(connection.checkedAt))}（设备时间）` : '';
  $('#connection-time').hidden=!connection.checkedAt;
  if(connection.checkedAt) $('#connection-time').dateTime=connection.checkedAt; else $('#connection-time').removeAttribute('datetime');
  $('#check-connection').hidden=!subscription;
  $('#check-connection').disabled=checking||busy;
  $('#check-connection').textContent=checking ? '正在检查…' : connection.state==='error' ? '重试检查' : '检查连接';
}
async function checkConnection() {
  if(!subscription || requestPending || managementRestoring || connectionController) return;
  const controller=new AbortController(), expected={id:subscription.id,revision:subscription.revision,feedUrl:subscription.feedUrl,version:subscriptionVersion};
  connectionController=controller;connection={state:'checking'};renderConnection();
  const result=await checkSubscriptionConnection({apiBaseUrl,feedUrl:expected.feedUrl,signal:controller.signal});
  if(controller!==connectionController || expected.version!==subscriptionVersion || expected.id!==subscription?.id || expected.revision!==subscription?.revision || expected.feedUrl!==subscription?.feedUrl) return;
  connectionController=null;
  if(result.state!=='cancelled') connection=result;
  renderConnection();
}
function renderSubscription() {
  $('#subscription-summary').textContent = `${selectionSummary()} · 全天显示 · ${zoneLabel()}`;
  // Once a calendar is added, this panel is "my subscription": status and
  // actions first; the add-a-calendar guide folds behind one button.
  // Only a subscription that already existed when the panel opened counts:
  // someone in the middle of adding keeps the add steps in view.
  const dialog=$('#subscription-dialog'), managing=Boolean(subscription) && dialog.dataset.mode==='manage';
  dialog.classList.toggle('is-managing',managing);
  if(!managing) dialog.classList.remove('show-add');
  $('#manage-panel').hidden=!managing;
  $('#manage-add').setAttribute('aria-expanded',String(dialog.classList.contains('show-add')));
  $('#subscription-title').textContent=managing ? '我的订阅' : '加入日历';
  $('#subscription-dialog .overline').textContent=managing ? '已加入日历' : '我的订阅';
  $('#entry-title').lastChild.textContent=managing ? '订阅地址' : '添加到日历';
  if(managing){
    $('#manage-title').lastChild.textContent=stopped ? '这份订阅已停用' : conflict ? '设置已在其他设备修改' : dirty() ? '有改动尚未保存' : '已加入日历，正在同步';
    $('#manage-next').textContent=dirty() ? '保存后，日历会在几小时内更新；订阅地址不变' : nextReminderText();
  }
  $('#subscription-new').hidden = Boolean(subscription);
  $('#subscription-existing').hidden = !subscription;
  $('#subscription-management').hidden = !subscription;
  $('#create-subscription').disabled = !hasSelectedContent() || requestPending;
  $('#save-subscription').hidden = !dirty();
  $('#save-subscription').disabled = requestPending || managementRestoring || conflict;
  $('#reload-subscription').hidden = !conflict;
  if (subscription) {
    $('#feed-url').value = subscription.feedUrl;
    $('#subscription-status').textContent = dirty() ? '当前修改尚未保存；日历仍使用上次保存的设置。' : '设置已保存，等待日历同步。订阅地址保持不变。';
  }
  const downloadable=downloadOccurrences();
  $('#downloads').innerHTML = ['remind','display'].map(mode => {
    const count = downloadable.filter(event => event.preference.mode === mode).length;
    return count ? `<button class="secondary" type="button" data-download="${mode}">${icon('download')}下载${mode === 'remind' ? '提醒' : '仅显示'}日历 · ${count} 项日程</button>` : '';
  }).join('') || '<p>近期没有可下载的已选日程。</p>';
  deviceGuide(); renderSaveState(); renderConnection();
}
function openSubscription({prepare=false}={}) {
  if(!entryError) $('#subscription-error').hidden = true;
  $('#stop-confirmation').hidden = true;
  $('#entry-attempt').hidden=true;
  if(!currentApp() && calendarDevice.recommendedApp) {
    $(`input[name="device"][value="${calendarDevice.recommendedApp}"]`).checked=true;
    ui.app=calendarDevice.recommendedApp; persistUI();
  }
  if (!$('#subscription-dialog').open) $('#subscription-dialog').dataset.mode=subscription ? 'manage' : 'add';
  renderSubscription();
  if (!$('#subscription-dialog').open) $('#subscription-dialog').showModal();
  if(prepare) {
    if(subscription && dirty()) void saveSubscription();
    else void prepareSubscription();
  }
}
async function prepareSubscription({retry=false}={}) {
  if(subscription || requestPending || managementRestoring || creationBlocked || !currentApp() || !hasSelectedContent() || !settings.zone) return;
  if(currentApp()==='iphone' && calendarDevice.apple && calendarDevice.inAppBrowser) return;
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
    resetConnection();lastWriteKind='';
    clearSubscriptionError();
    subscription = null; conflict = false; stopped = true; persist(); renderSaveState(); renderSubscription();
    notify('这份订阅已停用。请在手机日历中移除原订阅。');
    return;
  }
  const remote = normalizeSettings(result.settings,data.catalog);
  const feedUrl=safeHTTP(result.feedUrl || subscription?.feedUrl);
  if(!feedUrl) throw new Error('订阅服务返回的地址无效。你的选择已保留，请稍后重试。');
  clearSubscriptionError();
  if(result.id && result.id!==subscription?.id) guide?.resetConfirmations();
  if(subscription && (result.id && result.id!==subscription.id || result.revision!==subscription.revision || feedUrl!==subscription.feedUrl)) {resetConnection();lastWriteKind='';}
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
  resetConnection();
  let createdSuccessfully=false;
  requestPending = true; entryError=false; renderSubscription(); $('#subscription-error').hidden = true;
  try {
    // Validate the complete feed before sending settings. DST changes use the
    // same compatible resolution policy as the subscription service.
    if (!create || !pendingCreation) exportICS(selectCalendarOccurrences(data,settings),{zone:settings.zone,name:'藏历'});
    if(create && !apiBaseUrl) throw new Error('暂时无法完成订阅，请稍后重试。你的选择已保留，也可以使用下方文件导入。');
    const attempt=create ? creationAttempt() : null;
    const submitted = clone(attempt ? attempt.settings : settings);
    const result = await api(create ? 'POST' : 'PATCH',create ? '/api/subscriptions' : `/api/subscriptions/${encodeURIComponent(subscription.id)}`,
      create ? {settings:submitted} : {settings:{...submitted,titleMarks:submitted.titleMarks||'none'},revision:subscription.revision},undefined,attempt?.key);
    if(create && (!/^[a-f0-9-]{36}$/.test(result.id) || !/^[A-Za-z0-9_-]{43}$/.test(result.manageToken) ||
        !Number.isSafeInteger(result.revision) || result.revision<1 || !result.settings || result.disabled)) {
      throw new Error('订阅服务返回的信息不完整。创建进度已保留，请重试恢复同一份订阅。');
    }
    const changedDuringSave = JSON.stringify(settings) !== JSON.stringify(submitted);
    const latestDraft = clone(settings);
    acceptRemote(result,true);
    lastWriteKind=create?'created':'saved';createdSuccessfully=create;
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
    } else notify(phoneLike()?'已保存。手机日历通常几小时内自动更新。':'已保存。日历通常几小时内自动更新。');
  } catch (error) { showSubscriptionError(error); }
  finally {
    requestPending = false; renderSubscription();
    if(createdSuccessfully) void checkConnection();
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
  resetConnection();
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
  try { await navigator.clipboard.writeText(value); notify(`${label}已复制`); return true; }
  catch {
    const input = document.createElement('textarea'); input.value = value;
    input.style.cssText = 'position:fixed;opacity:0'; document.body.append(input); input.select();
    let copied=false;
    try {copied=document.execCommand('copy');} catch {}
    input.remove();
    if (copied) {notify(`${label}已复制`);return true;}
    else {
      const output = document.createElement('input'); output.value = value; output.readOnly = true; output.setAttribute('aria-label',label);
      $('#subscription-error').replaceChildren(document.createTextNode(`请手动复制${label}：`),output); $('#subscription-error').hidden = false; output.focus(); output.select();
      return false;
    }
  }
}
function download(content, filename) {
  const url = URL.createObjectURL(new Blob([content],{type:'text/calendar;charset=utf-8'}));
  const link = document.createElement('a'); link.href = url; link.download = filename; document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url),60000);
}
function downloadOccurrences() {
  if(!settings.includeDailyDates) return upcoming;
  const key=JSON.stringify([today,settings]);
  if(downloadCache.key!==key) downloadCache={key,events:selectCalendarOccurrences(data,settings,{start:today,end:rangeEnd(today,24)})};
  return downloadCache.events;
}
function downloadCalendar(mode) {
  try {
    const events = downloadOccurrences().filter(event => event.preference.mode === mode);
    download(exportICS(events,{zone:settings.zone,titleMarks:settings.titleMarks,name:mode === 'remind' ? '慧灯藏历 · 修行提醒' : '慧灯藏历 · 仅显示',sourceVersion:data.updatedOn}),`藏历-${mode === 'remind' ? '提醒' : '仅显示'}.ics`);
    $('#download-status').textContent = '已发起下载。请继续在日历应用中导入，并检查通知设置。';
  } catch (error) { $('#download-status').textContent = error.message; }
}
function attachEvents() {
  installDisclosureMotion();
  $('#include-daily-dates').addEventListener('change',event=>{
    settings.includeDailyDates=event.target.checked;stopped=false;refresh(false);
    playMotion(event.target,'check');
    if(event.target.checked) playSymbol($('.daily-date-icon svg'));
  });
  $('#preset-options').addEventListener('click',event=>{
    const button=event.target.closest('[data-preset]');if(!button)return;
    // Tapping the chosen plan again cancels it, like the checkbox below it.
    if(button.getAttribute('aria-pressed')==='true'){
      const before=clone(settings);
      for(const [id,pref] of Object.entries(settings.events)){ if(pref.mode!=='off')lastActive.set(id,clone(pref)); pref.mode='off'; }
      stopped=false;refresh();
      $('#preset-options').querySelector(`[data-preset="${button.dataset.preset}"]`)?.focus({preventScroll:true});
      notify(subscription?'已取消这个方案；保存修改后更新日历。':'已取消这个方案。',()=>restoreSnapshot(before,'已恢复之前的选择。'));
      return;
    }
    const firstChoice=!hasSelectedContent();
    const next=applyPreset(settings,data.catalog,button.dataset.preset);
    // Days newly added by a preset follow the time already chosen in step 2.
    const chosenTimes=new Set(remindPrefs().map(pref=>JSON.stringify(pref.reminders)));
    if(chosenTimes.size===1){const reminders=JSON.parse([...chosenTimes][0]);
      for(const [id,pref] of Object.entries(next.events)) if(pref.mode==='remind' && settings.events[id]?.mode!=='remind') pref.reminders=reminders.map(r=>({...r}));}
    if(JSON.stringify(next)===JSON.stringify(settings))return;
    settings=next;lastActive.clear();stopped=false;
    refresh();
    const chosen=$('#preset-options').querySelector(`[data-preset="${button.dataset.preset}"]`);
    chosen?.focus({preventScroll:true});
    playMotion(chosen?.querySelector('.preset-check'),'check');
    playSymbol(chosen?.querySelector('.preset-icon svg'));
    // On a phone, the first choice brings step 2 into view so the next decision
    // is visible without hunting for it.
    if(firstChoice && phoneLike()){
      const step=$('#time-title')?.closest('.quick-section'), action=$('.action-bar')?.getBoundingClientRect().top ?? innerHeight;
      const box=step?.getBoundingClientRect();
      if(box && box.bottom>action-8) step.scrollIntoView({block:'end',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});
    }
  });
  $('#time-choices').addEventListener('click',event=>{
    const button=event.target.closest('[data-time-choice]');if(!button||button.disabled)return;
    const [daysBefore,time]=button.dataset.timeChoice.split('|');
    for(const pref of remindPrefs()) pref.reminders=[{daysBefore:Number(daysBefore),time}];
    stopped=false;refresh();
    button.focus({preventScroll:true});playMotion(button,'check');
    notify(subscription?'提醒时间已改；保存修改后同步到日历。':`所有提醒改为${reminderLabel([{daysBefore:Number(daysBefore),time}])}。`);
  });
  $('#share-settings').addEventListener('click',openShare);
  $('#subscribed-open').addEventListener('click',()=>openSubscription());
  $('#manage-share').addEventListener('click',()=>openShare());
  $('#manage-add').addEventListener('click',()=>{
    const dialog=$('#subscription-dialog'), show=!dialog.classList.contains('show-add');
    dialog.classList.toggle('show-add',show);$('#manage-add').setAttribute('aria-expanded',String(show));
    if(show) $('.device-options')?.scrollIntoView({block:'nearest',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});
  });
  for(const input of document.querySelectorAll('input[name="title-marks"]')) input.addEventListener('change',()=>{
    if(input.value==='none') delete settings.titleMarks; else settings.titleMarks=input.value;
    stopped=false;refresh(false);
    notify(subscription?'标记样式已改；保存修改后，日历下次同步时更新。':'标记样式已改。');
  });
  if(calendarDevice.inAppBrowser){
    $('#wechat-banner').hidden=false;
    // Any browser will do; naming one brand would confuse people on other phones.
    $('#wechat-banner-text').innerHTML=`${esc(calendarDevice.inAppBrowser)}里不能直接加入日历。点右上角 <b>···</b>，选择“在浏览器中打开”再继续；已在浏览器里加过的，在浏览器里打开就能看到`;
  }
  // Clouds only drift while the banner is on screen: no work for a hidden layer.
  const clouds=$('.masthead-clouds');
  if(clouds && 'IntersectionObserver' in window) new IntersectionObserver(([entry])=>clouds.classList.toggle('is-paused',!entry.isIntersecting)).observe(clouds);
  const advanced=$('#advanced-settings');
  // Phones open in the simple three steps; computers show everything. A
  // person's own choice is remembered on this device.
  advanced.open=typeof ui.advancedOpen==='boolean' ? ui.advancedOpen : !matchMedia('(max-width:1023px)').matches;
  const syncAdvanced=()=>$('#app').classList.toggle('advanced-closed',!advanced.open);
  syncAdvanced();
  advanced.addEventListener('toggle',()=>{ui.advancedOpen=advanced.open;persistUI();syncAdvanced();});
  const dailyUrl=new URL('./daily-dates.ics',location.href);
  if(dailyUrl.protocol==='https:') $('#daily-calendar-apple').href=dailyUrl.href.replace(/^https:/,'webcal:');
  $('#daily-calendar-apple').hidden=!calendarDevice.apple || dailyUrl.protocol!=='https:';
  // The offline single-file page has no shared file to subscribe to.
  $('.daily-calendar').hidden=!/^https?:$/.test(dailyUrl.protocol);
  $('#daily-calendar-copy').addEventListener('click',()=>void copy(dailyUrl.href,'每日藏历订阅地址'));
  $('#clear-selection').addEventListener('click',()=>{
    if(!hasSelectedContent())return;
    const before=clone(settings);
    for(const [id,pref] of Object.entries(settings.events)) {
      if(pref.mode!=='off')lastActive.set(id,clone(pref));
      pref.mode='off';
    }
    settings.includeDailyDates=false;stopped=false;refresh();
    if($('.workspace').dataset.activeTab==='preview' && matchMedia('(max-width:1023px)').matches) $('[data-cal-view="month"]').focus({preventScroll:true});
    else $('#preset-options button').focus({preventScroll:true});
    notify(subscription?'已清空选择；保存修改后更新日历。':'已清空选择。',()=>restoreSnapshot(before,'已恢复之前的选择。'));
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
  // Tapping a symbol anywhere it stands for a day (list, day cards, the
  // masthead knot) plays its own motion — a small reward for curiosity.
  document.addEventListener('click',event=>{
    const holder=event.target.closest?.('.cal-event-icon, .cal-daily-icon, .masthead-next .icon, .masthead-next');
    if(!holder)return;
    playSymbol(holder.matches('svg') ? holder : holder.querySelector('svg'));
  });
  // Opening a category by hand plays its symbol; restored or re-drawn open
  // categories stay still.
  const openedByHand=new WeakSet();
  $('#groups').addEventListener('click',event=>{const summary=event.target.closest('.group-card>summary');if(summary)openedByHand.add(summary.parentElement);});
  $('#groups').addEventListener('toggle',event=>{
    const card=event.target;if(!openedByHand.has(card))return;openedByHand.delete(card);
    if(card.open) playSymbol(card.querySelector('.group-icon svg'));
  },true);
  $('#groups').addEventListener('change',event => {
    const id = event.target.dataset.event; if (!id) return;
    const pref = settings.events[id];
    if (event.target.checked) settings.events[id] = clone(lastActive.get(id) || {mode:'display',reminders:pref.reminders.length ? pref.reminders : defaultReminders()});
    else { lastActive.set(id,clone(pref)); pref.mode = 'off'; }
    stopped = false; refresh();
    playMotion(document.getElementById(`event-${id}`),'check');
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
  // The panel grows out of the button that opened it, so the step reads as
  // one continuous action rather than a page jump.
  $('#subscribe').addEventListener('click',event => {
    const dialog=$('#subscription-dialog'), wasOpen=dialog.open;
    openSubscription({prepare:true});
    if(wasOpen || !dialog.open) return;
    const from=event.currentTarget.getBoundingClientRect(), to=dialog.getBoundingClientRect();
    dialog.style.setProperty('--from-x',`${Math.round(from.left+from.width/2-(to.left+to.width/2))}px`);
    dialog.style.setProperty('--from-y',`${Math.round(from.top+from.height/2-(to.top+to.height/2))}px`);
    dialog.classList.add('from-cta');
    dialog.addEventListener('animationend',()=>dialog.classList.remove('from-cta'),{once:true});
    dialog.addEventListener('close',()=>dialog.classList.remove('from-cta'),{once:true});
  });
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
  $('#copy-feed').addEventListener('click',async() => {
    if(!subscription||requestPending||managementRestoring||dirty()||conflict)return;
    const feed=subscription.feedUrl,app=currentApp(),copied=await copy(feed,'订阅地址');
    if(!['google','outlook'].includes(app)||calendarDevice.mobile||currentApp()!==app||subscription?.feedUrl!==feed)return;
    const progress=$('#copy-progress');progress.dataset.app=app;progress.dataset.feed=feed;
    progress.textContent=copied?`地址已复制。下一步打开 ${app==='google'?'Google 日历添加页面':'Outlook 网页日历'}，粘贴并确认添加。`:'未能自动复制。请先手动复制上方选中的地址，再打开日历添加页面。';
    progress.hidden=false;
  });
  $('#check-connection').addEventListener('click',checkConnection);
  $('#copy-page').addEventListener('click',()=>{const url=new URL(location.href);url.hash='';url.search='';void copy(url.href,'网页地址');});
  $('#apple-browser-help').addEventListener('click',()=>{
    const help=$('[data-guide-help="open-failed"]');
    if(!help || currentApp()!=='iphone')return;
    help.open=true;
    const summary=help.querySelector('summary');
    summary?.scrollIntoView({block:'center',behavior:'auto'});
    summary?.focus({preventScroll:true});
  });
  for(const selector of ['#iphone-subscribe','#google-subscribe','#outlook-subscribe']) $(selector).addEventListener('click',event=>{
    if(!subscription || requestPending || managementRestoring || dirty() || conflict || !event.currentTarget.hasAttribute('href')) {event.preventDefault();return;}
    // No success signal: only the user can confirm seeing the events.
    $('#entry-attempt').hidden=false;
    $('#entry-attempt').textContent=selector==='#iphone-subscribe' ? '请在日历中确认添加。若没有打开，可查看下方帮助或复制订阅地址。' : selector==='#outlook-subscribe' ? '请在 Outlook 网页版的“从 Web 订阅”中粘贴地址并确认添加。工作或学校账号也可使用所在组织的 Outlook 网页版。' : '请在 Google 日历网页中粘贴订阅地址并确认添加。';
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
async function restoreManagementLink() {
  const manage = new URLSearchParams(location.hash.slice(1)).get('manage');
  if (manage === null) return;
  const attempt = ++managementAttempt;
  subscriptionVersion++;
  resetConnection();lastWriteKind='';
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
    if(candidate.id!==subscription?.id) guide?.resetConfirmations();
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
  const sharedNotice=applySharedSettings();
  zonePicker=createZonePicker($('#zone-dialog'),{onApply:zone=>{
    settings.zone=zone;stopped=false;ui.lastDeviceZone=observedZone;persistUI();refresh(false);
    notify(subscription?'提醒地区已调整；点击保存修改后同步。':'提醒地区已调整。');
  }});
  calendarView=createCalendarView($('#calendar-preview'),{initialView:ui.view==='list'?'list':'month',today,
    onViewChange:view=>{ui.view=view;persistUI();},
    onEditEvent:(id,trigger)=>{const item=data.catalog.events.find(event=>event.id===id);if(item)openReminders([id],item.title,trigger);}});
  guide=createSubscriptionGuide($('#device-guide'),{notificationRoot:$('#notification-guide'),initialState:ui.guide,
    onStateChange:state=>{ui.guide=state;persistUI();}});
  const savedApp=['iphone','google','outlook','other'].includes(ui.app) ? ui.app : ui.guide?.app;
  if(['iphone','google','outlook','other'].includes(savedApp)) $(`input[name="device"][value="${savedApp}"]`).checked=true;
  attachEvents(); $('#app').hidden = false; renderGroups(); renderPresets();renderPreview(); persist();persistUI();checkDeviceTime();
  if(pendingCreation?.blocked) showSubscriptionError(pendingCreation.blocked);
  if(sharedNotice) notify(sharedNotice);
  // Reuse the browser's completed layout. Writing a root variable between two
  // bounding-box reads forced the whole document to lay out twice on startup.
  const actionBar=$('.action-bar'), previewColumn=$('.preview-column');
  let barHeight=86, previewHeight=Infinity;
  const resizeLayout=()=>{
    const value=`${barHeight}px`;
    if(document.documentElement.style.getPropertyValue('--action-height')!==value)
      document.documentElement.style.setProperty('--action-height',value);
    // A preview shorter than the window sticks to the top. A taller one scrolls
    // with the page until its bottom edge meets the action bar, then stays,
    // so the calendar remains beside a long list of categories.
    const room=innerHeight-barHeight;
    previewColumn.classList.add('can-stick');
    const top=previewHeight<room-40 ? 16 : Math.round(room-previewHeight-16);
    if(previewColumn.style.getPropertyValue('--stick-top')!==`${top}px`) previewColumn.style.setProperty('--stick-top',`${top}px`);
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
