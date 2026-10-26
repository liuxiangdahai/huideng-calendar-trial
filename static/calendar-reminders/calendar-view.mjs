import {ENGINE, getTibetanDate} from './engine.mjs';
import {addDays, reminderLabel, zonedInstant} from './core.mjs';
import {icon} from './icons.mjs';
import {eventPresentation, eventIcon} from './event-presentation.mjs';
import {resolveTimeZone, wallTimeInZone, zoneInfo} from './timezones.mjs';

const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日'];
const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[char]));
const civil = date => new Date(date + 'T12:00:00Z');
const iso = date => date.toISOString().slice(0, 10);
const clamp = (date, start, end) => date < start ? start : date > end ? end : date;
const monthTitle = month => `${Number(month.slice(0, 4))}年${Number(month.slice(5, 7))}月`;
const dateTitle = date => `${Number(date.slice(0, 4))}年${Number(date.slice(5, 7))}月${Number(date.slice(8))}日`;
const weekIndex = date => (civil(date).getUTCDay() + 6) % 7;
const idOf = event => event.eventId || event.id;
const dayPart = tibetan => tibetan.display.split('月').at(-1);

function validDate(date) {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      !Number.isFinite(civil(date).valueOf()) || iso(civil(date)) !== date) throw new RangeError('日期无效。');
  return date;
}

/** Civil-date arithmetic never depends on the reminder timezone. */
export function shiftMonth(date, count) {
  validDate(date);
  const result = civil(date), day = result.getUTCDate();
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() + count);
  const last = new Date(Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0)).getUTCDate();
  result.setUTCDate(Math.min(day, last));
  return iso(result);
}

export function navigateDate(date, key, {start = ENGINE.supported.start, end = ENGINE.supported.end} = {}) {
  validDate(date);
  const offsets = {ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7,
    Home: -weekIndex(date), End: 6 - weekIndex(date)};
  let next;
  if (Object.hasOwn(offsets, key)) next = addDays(date, offsets[key]);
  else if (key === 'PageUp' || key === 'PageDown') next = shiftMonth(date, key === 'PageUp' ? -1 : 1);
  else return null;
  return clamp(next, start, end);
}

function tibetanDetails(date) {
  if (date < ENGINE.supported.start || date > ENGINE.supported.end) return null;
  const tibetan = getTibetanDate(date);
  let repeatNumber = tibetan.dayLeap ? 2 : 0;
  if (!repeatNumber && date < ENGINE.supported.end) {
    const next = getTibetanDate(addDays(date, 1));
    if (next.dayLeap && next.year === tibetan.year && next.month === tibetan.month &&
        next.monthLeap === tibetan.monthLeap && next.day === tibetan.day) repeatNumber = 1;
  }
  return {...tibetan, repeatNumber,
    fullLabel: `藏历${tibetan.yearName}年${tibetan.display}${repeatNumber ? `（重日第${repeatNumber === 1 ? '一' : '二'}次）` : ''}`};
}

/** Exactly six Monday-first weeks. Missing Tibetan days do not create cells. */
export function monthCells(month, {start = ENGINE.supported.start, end = ENGINE.supported.end,
  today, selected, events = []} = {}) {
  if (typeof month !== 'string' || !/^\d{4}-\d{2}$/.test(month)) throw new RangeError('月份无效。');
  validDate(month + '-01');
  const first = addDays(month + '-01', -weekIndex(month + '-01'));
  const byDate = new Map();
  for (const event of events) {
    if (event.preference?.mode === 'off') continue;
    if (!byDate.has(event.date)) byDate.set(event.date, []);
    byDate.get(event.date).push(event);
  }
  return Array.from({length: 42}, (_, index) => {
    const date = addDays(first, index), tibetan = tibetanDetails(date);
    return {date, day: Number(date.slice(8)), inMonth: date.startsWith(month), today: date === today,
      selected: date === selected, disabled: date < start || date > end, tibetan,
      tibetanShort: tibetan ? `${tibetan.monthLeap ? '闰' : ''}${dayPart(tibetan)}${tibetan.dayLeap ? '·重' : ''}` : '',
      repeatNumber: tibetan?.repeatNumber || 0, events: byDate.get(date) || [],
      count: byDate.get(date)?.length || 0};
  });
}

/** Distinguish absent selections, confirmed empty dates, and records not yet confirmed. */
export function previewAvailability(data, settings, {start, end}) {
  const selected = (data?.catalog?.events || []).filter(event => settings?.events?.[event.id]?.mode && settings.events[event.id].mode !== 'off');
  const coverage = data?.published?.coverage;
  const outsideCoverage = !coverage || start < coverage.start || end > coverage.end;
  const unconfirmed = outsideCoverage ? selected.filter(event => !event.rule) : [];
  return {selectedCount: selected.length, unconfirmedCount: unconfirmed.length,
    unconfirmedTitles: unconfirmed.map(event => event.title), hasUnconfirmed: unconfirmed.length > 0};
}

const reminderText = event => event.preference?.mode === 'remind'
  ? reminderLabel(event.preference.reminders) : '仅显示，不提醒';

/** Convert each actual alarm, including advance days, using that date's rules. */
export function deviceReminderTimes(event, reminderZone, deviceZone) {
  const source = resolveTimeZone(reminderZone), target = resolveTimeZone(deviceZone);
  if (!source || !target || source === target || event.preference?.mode !== 'remind') return [];
  return (event.preference.reminders || []).map(reminder => {
    const instant = zonedInstant(addDays(event.date, -reminder.daysBefore), reminder.time, source);
    const local = wallTimeInZone(instant, target);
    return {date: local.slice(0, 10), time: local.slice(11, 16),
      zoneLabel: zoneInfo(target, instant).label};
  });
}

function eventMarkup(event, location, state) {
  const id = idOf(event);
  const presentation = eventPresentation(event, state.data?.catalog);
  const localTimes = deviceReminderTimes(event, state.settings?.zone, state.deviceZone);
  const converted = localTimes.length ? `<p class="cal-device-time">设备当地 · ${escape(localTimes[0].zoneLabel)}<span>${localTimes.map(time => escape(`${dateTitle(time.date)} ${time.time}`)).join('；')}</span></p>` : '';
  return `<article class="cal-event ${presentation.colorClass}"><div class="cal-event-heading"><span class="cal-event-icon">${eventIcon(event, state.data?.catalog)}</span><div class="cal-event-name"><h4>${escape(event.title)}</h4><div class="cal-event-meta"><span>${escape(presentation.label)}</span><span class="cal-all-day">全天</span></div></div></div>
    <button type="button" class="cal-reminder${event.preference?.mode === 'remind' ? ' is-active' : ''}" data-cal-event="${escape(id)}" data-cal-focus="${escape(location + '-' + event.uid)}" aria-label="调整${escape(event.title)}的提醒">${icon(event.preference?.mode === 'remind' ? 'bell' : 'bell-off')}<span>${escape(reminderText(event))}</span><span class="cal-edit">调整提醒</span></button>${converted}</article>`;
}

/**
 * Browser controller. Caller owns the device-local today, settings and occurrences.
 * All view/navigation state stays here and never modifies subscription settings.
 */
export function createCalendarView(root, {onEditEvent = () => {}, onViewChange = () => {},
  initialView = 'month', today} = {}) {
  validDate(today);
  const doc = root.ownerDocument, win = doc.defaultView;
  let view = initialView === 'list' ? 'list' : 'month';
  let month = today.slice(0, 7), selected = today, focusDate = today, shown = 5;
  let state = {data: null, settings: null, events: [], today,
    start: ENGINE.supported.start, end: ENGINE.supported.end};
  const scrollByView = {};
  let disposed = false;
  root.classList.add('cal-view');
  root.innerHTML = `<div class="cal-control-bar"><div class="cal-toolbar" data-cal-navigation>
      <button type="button" class="cal-arrow" data-cal-action="previous" data-cal-focus="previous" aria-label="上一月">${icon('chevron-left')}</button>
      <label class="cal-month-picker"><span class="sr-only">选择月份</span><select data-cal-month data-cal-focus="month-picker" aria-label="选择月份"></select>${icon('chevron')}</label>
      <button type="button" class="cal-arrow" data-cal-action="next" data-cal-focus="next" aria-label="下一月">${icon('chevron-right')}</button>
      <button type="button" class="cal-today" data-cal-action="today" data-cal-focus="today">今天</button>
    </div><div class="cal-view-switch" role="group" aria-label="日期预览方式">
      <button type="button" data-cal-view="month" data-cal-focus="month-view">${icon('calendar')}<span>月历</span></button>
      <button type="button" data-cal-view="list" data-cal-focus="list-view">${icon('list')}<span>列表</span></button>
    </div></div><section class="cal-month-view" aria-label="月历预览"><p class="cal-month-context" data-cal-context></p>
    <div class="cal-grid" role="grid" aria-label="月历，使用方向键浏览日期，回车查看日程" data-cal-grid></div>
    <section class="cal-day-detail" aria-label="所选日期的日程" data-cal-detail></section>
  </section><section class="cal-list-view" aria-label="近期日程列表" hidden>
    <p class="cal-list-caption">从今天起，查看已选择的日程。</p><div class="cal-list" data-cal-list></div>
    <button type="button" class="cal-more" data-cal-action="more" data-cal-focus="more">查看更多日期</button>
    <p class="cal-data-note" data-cal-list-note hidden></p>
  </section><p class="sr-only" aria-live="polite" aria-atomic="true" data-cal-announcement></p>`;
  const $ = selector => root.querySelector(selector);
  const monthRoot = $('.cal-month-view'), listRoot = $('.cal-list-view');

  function activeKey() {
    return root.contains(doc.activeElement) ? doc.activeElement.dataset.calFocus : null;
  }
  function restoreFocus(key) {
    if (!key) return;
    // Values originate in our own DOM; avoid inserting any arbitrary text in CSS selectors.
    [...root.querySelectorAll('[data-cal-focus]')].find(node => node.dataset.calFocus === key)?.focus({preventScroll: true});
  }
  function announce(text) { $('[data-cal-announcement]').textContent = text; }
  function empty(message) { return `<p class="cal-empty">${escape(message)}</p>`; }
  function unknownNote() { return '部分所选日程的后续安排尚待确认，确认后会随订阅更新。'; }

  function renderMonth() {
    const cells = monthCells(month, {...state, selected});
    const picker = $('[data-cal-month]');
    const options = [];
    for (let cursor = state.start.slice(0, 7); cursor <= state.end.slice(0, 7); cursor = shiftMonth(cursor + '-01', 1).slice(0, 7)) {
      options.push(`<option value="${cursor}">${monthTitle(cursor)}</option>`);
    }
    picker.innerHTML = options.join('');
    picker.value = month;
    $('[data-cal-action="previous"]').disabled = month <= state.start.slice(0, 7);
    $('[data-cal-action="next"]').disabled = month >= state.end.slice(0, 7);
    $('[data-cal-action="today"]').disabled = state.today < state.start || state.today > state.end;
    const tibetanMonths = [...new Set(cells.filter(cell => cell.inMonth && cell.tibetan)
      .map(cell => `藏历${cell.tibetan.yearName}年${cell.tibetan.display.split('月')[0]}月`))];
    $('[data-cal-context]').textContent = tibetanMonths.join(' · ');
    const header = `<div class="cal-weekdays" role="row">${WEEKDAYS.map(day => `<span role="columnheader" aria-label="星期${day}">${day}</span>`).join('')}</div>`;
    const rows = Array.from({length: 6}, (_, row) => `<div class="cal-week" role="row">${cells.slice(row * 7, row * 7 + 7).map(cell => {
      const cellEvents = cell.disabled ? [] : cell.events;
      const aria = `${dateTitle(cell.date)}，星期${WEEKDAYS[weekIndex(cell.date)]}，${cell.tibetan?.fullLabel || '超出藏历换算范围'}，${cell.disabled ? '超出预览范围' : `${cell.count}项已选日程`}${cellEvents.length ? `，${cellEvents.map(event => event.title).join('；')}` : ''}`;
      const markers = [...new Set(cellEvents.map(event => eventPresentation(event, state.data?.catalog).colorClass))];
      const labels = cellEvents.slice(0, 2).map(event => {
        const presentation = eventPresentation(event, state.data?.catalog);
        return `<span class="cal-mini-event ${presentation.colorClass}" title="${escape(event.title)}">${escape(event.title)}</span>`;
      }).join('');
      const mobileSummary = cellEvents.length ? `<span class="cal-mobile-events" aria-hidden="true"><span class="cal-mobile-event ${eventPresentation(cellEvents[0], state.data?.catalog).colorClass}" title="${escape(cellEvents[0].title)}">${escape(cellEvents[0].title)}</span>${cellEvents.length > 1 ? `<span class="cal-mobile-more">另 ${cellEvents.length - 1} 项</span>` : ''}</span>` : '';
      return `<div role="gridcell" aria-selected="${cell.selected}" class="cal-cell"><button type="button" class="cal-day${cell.inMonth ? '' : ' cal-adjacent'}${cell.selected ? ' cal-selected' : ''}${cell.today ? ' cal-is-today' : ''}" data-cal-date="${cell.date}" data-cal-focus="date-${cell.date}" tabindex="${cell.date === focusDate && !cell.disabled ? 0 : -1}" aria-label="${escape(aria)}"${cell.today ? ' aria-current="date"' : ''}${cell.disabled ? ' disabled' : ''}>
        <span class="cal-day-date" aria-hidden="true"><span class="cal-gregorian">${cell.day}</span><span class="cal-tibetan">${escape(cell.tibetan ? dayPart(cell.tibetan) : '')}</span></span>
        <span class="cal-marks" aria-hidden="true">${cell.tibetan?.monthLeap ? '<span class="cal-leap">闰月</span>' : ''}${cell.repeatNumber ? `<span class="cal-repeat">重日${cell.repeatNumber}</span>` : ''}${cellEvents.length ? `<span class="cal-category-marks">${markers.slice(0, 3).map(color => `<i class="cal-category-dot ${color}"></i>`).join('')}</span><span class="cal-event-count">${cell.count}</span>` : ''}</span>
        <span class="cal-day-events" aria-hidden="true">${labels}${cellEvents.length > 2 ? `<span class="cal-more-events">另有 ${cellEvents.length - 2} 项</span>` : ''}</span>${mobileSummary}</button></div>`;
    }).join('')}</div>`).join('');
    $('[data-cal-grid]').innerHTML = header + rows;
    renderDetail();
  }

  function renderDetail() {
    const tibetan = tibetanDetails(selected), events = state.events.filter(event => event.date === selected);
    const available = previewAvailability(state.data, state.settings, {start: selected, end: selected});
    let content;
    if (!available.selectedCount) content = empty('还没有选择日程，请在“选择内容”中勾选你关注的日子。');
    else if (!events.length) content = empty(available.hasUnconfirmed
      ? '当天暂无已确认的所选日程；部分法会、节日或天象的安排尚待确认。'
      : '当天没有已选日程。可点选其他日期，或继续添加关注的日子。');
    else content = events.map(event => eventMarkup(event, 'day', state)).join('');
    $('[data-cal-detail]').innerHTML = `<div class="cal-detail-heading"><h3>${escape(dateTitle(selected))}<span>星期${WEEKDAYS[weekIndex(selected)]}</span></h3><p>${escape(tibetan?.fullLabel || '')}</p></div>${content}${events.length && available.hasUnconfirmed ? `<p class="cal-data-note">${unknownNote()}</p>` : ''}`;
  }

  function renderList() {
    const dates = [...new Set(state.events.filter(event => event.date >= state.today).map(event => event.date))].sort();
    const available = previewAvailability(state.data, state.settings, {start: state.today, end: state.end});
    const list = $('[data-cal-list]');
    if (!available.selectedCount) list.innerHTML = empty('还没有选择日程，请在“选择内容”中勾选你关注的日子。');
    else if (!dates.length) list.innerHTML = empty(available.hasUnconfirmed
      ? '所选日程的后续安排尚待确认。确认后会随订阅更新。'
      : '近期没有已选日程。可以选择其他关注的日子。');
    else list.innerHTML = dates.slice(0, shown).map(date => {
      const tibetan = tibetanDetails(date);
      return `<section class="cal-list-day" data-cal-list-date="${date}"><div class="cal-list-date"><span>${Number(date.slice(5, 7))}月</span><strong>${Number(date.slice(8))}</strong><span>${date.slice(0, 4)}年</span></div><div class="cal-list-content"><h3>星期${WEEKDAYS[weekIndex(date)]}${date === state.today ? '<span class="cal-today-label">今天</span>' : ''}</h3><p class="cal-list-tibetan">${escape(tibetan?.fullLabel || '')}</p>${state.events.filter(event => event.date === date).map(event => eventMarkup(event, 'list', state)).join('')}</div></section>`;
    }).join('');
    $('[data-cal-action="more"]').hidden = dates.length <= shown;
    const note = $('[data-cal-list-note]');
    note.hidden = !available.hasUnconfirmed || !dates.length;
    note.textContent = unknownNote();
  }

  function render() {
    const focus = activeKey();
    renderMonth(); renderList();
    monthRoot.hidden = view !== 'month'; listRoot.hidden = view !== 'list';
    $('[data-cal-navigation]').hidden = view !== 'month';
    root.querySelectorAll('[data-cal-view]').forEach(button => {
      button.setAttribute('aria-pressed', String(button.dataset.calView === view));
    });
    restoreFocus(focus);
  }

  function setView(next) {
    if (!['month', 'list'].includes(next) || next === view) return;
    scrollByView[view] = win?.scrollY || 0;
    view = next;
    monthRoot.hidden = view !== 'month'; listRoot.hidden = view !== 'list';
    $('[data-cal-navigation]').hidden = view !== 'month';
    root.querySelectorAll('[data-cal-view]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.calView === view)));
    onViewChange(view);
    if (Object.hasOwn(scrollByView, view)) win?.scrollTo({top: scrollByView[view], behavior: 'instant'});
  }

  function changeMonth(next) {
    const safeMonth = clamp(next, state.start.slice(0, 7), state.end.slice(0, 7));
    const oldDay = Number(selected.slice(8));
    const last = Number(addDays(shiftMonth(safeMonth + '-01', 1), -1).slice(8));
    selected = clamp(`${safeMonth}-${String(Math.min(oldDay, last)).padStart(2, '0')}`, state.start, state.end);
    month = safeMonth; focusDate = selected;
    const focus = activeKey(); renderMonth(); restoreFocus(focus);
    announce(monthTitle(month));
  }

  function onClick(event) {
    const button = event.target.closest('button');
    if (!button || !root.contains(button)) return;
    if (button.dataset.calView) return setView(button.dataset.calView);
    if (button.dataset.calEvent) return onEditEvent(button.dataset.calEvent, button);
    if (button.dataset.calDate) {
      selected = button.dataset.calDate; focusDate = selected; month = selected.slice(0, 7);
      renderMonth(); restoreFocus('date-' + focusDate);
      announce(`${dateTitle(selected)}，${state.events.filter(item => item.date === selected).length}项已选日程`);
      return;
    }
    if (button.dataset.calAction === 'previous' || button.dataset.calAction === 'next') {
      changeMonth(shiftMonth(month + '-01', button.dataset.calAction === 'previous' ? -1 : 1).slice(0, 7));
    } else if (button.dataset.calAction === 'today') {
      selected = state.today; focusDate = selected; month = selected.slice(0, 7);
      renderMonth(); restoreFocus('today'); announce(`今天，${dateTitle(selected)}`);
    } else if (button.dataset.calAction === 'more') {
      shown += 5; renderList();
      // Keep the current viewport and offer the next newly displayed date to keyboard users.
      if (!$('[data-cal-action="more"]').hidden) restoreFocus('more');
      else [...$('[data-cal-list]').querySelectorAll('button')].at(-1)?.focus({preventScroll: true});
    }
  }

  function onKeyDown(event) {
    const button = event.target.closest('[data-cal-date]');
    if (!button || !root.contains(button) || event.altKey || event.ctrlKey || event.metaKey) return;
    const next = navigateDate(button.dataset.calDate, event.key, state);
    if (!next) return; // Enter and Space invoke the button's normal click behavior.
    event.preventDefault();
    focusDate = next; month = next.slice(0, 7);
    renderMonth(); restoreFocus('date-' + focusDate);
  }
  function onChange(event) {
    if (event.target.matches('[data-cal-month]')) changeMonth(event.target.value);
  }
  root.addEventListener('click', onClick);
  root.addEventListener('keydown', onKeyDown);
  root.addEventListener('change', onChange);

  return {
    update(next) {
      if (disposed) return;
      const anchor = view === 'list' ? [...root.querySelectorAll('[data-cal-list-date]')]
        .find(node => node.getBoundingClientRect().bottom > 0 && node.getBoundingClientRect().top < (win?.innerHeight || 0)) : null;
      const anchorDate = anchor?.dataset.calListDate, anchorTop = anchor?.getBoundingClientRect().top;
      state = {...state, ...next};
      validDate(state.today); validDate(state.start); validDate(state.end);
      state.start = state.start < ENGINE.supported.start ? ENGINE.supported.start : state.start;
      state.end = state.end > ENGINE.supported.end ? ENGINE.supported.end : state.end;
      if (state.start > state.end) throw new RangeError('预览日期范围无效。');
      state.events = (state.events || []).map(event => ({...event, preference: event.preference || state.settings?.events?.[idOf(event)]}))
        .filter(event => event.date >= state.start && event.date <= state.end && event.preference?.mode !== 'off');
      month = clamp(month, state.start.slice(0, 7), state.end.slice(0, 7));
      selected = clamp(selected, state.start, state.end); focusDate = clamp(focusDate, state.start, state.end);
      // A rolling-boundary update can remove the previously focused day from this month.
      if (focusDate.slice(0, 7) !== month) focusDate = clamp(month + '-01', state.start, state.end);
      render();
      if (anchorDate && win) {
        const updated = [...root.querySelectorAll('[data-cal-list-date]')].find(node => node.dataset.calListDate === anchorDate);
        if (updated) win.scrollBy({top: updated.getBoundingClientRect().top - anchorTop, behavior: 'instant'});
      }
    },
    setView,
    destroy() {
      disposed = true;
      root.removeEventListener('click', onClick);
      root.removeEventListener('keydown', onKeyDown);
      root.removeEventListener('change', onChange);
    }
  };
}
