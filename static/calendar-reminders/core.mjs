import {ENGINE, generateOccurrences, dailyDateOccurrences} from './engine.mjs';
import {resolveTimeZone, deviceTimeZone, ZONE_LABELS, civilDateInZone, wallTimeInZone} from './timezones.mjs';

export const MODES = {off: '不添加', display: '仅加入日历', remind: '加入并提醒'};
export const ZONES = ZONE_LABELS;
export function addDays(date, count) {
  return new Date(Date.parse(date + 'T12:00:00Z') + count * 86400000).toISOString().slice(0, 10);
}
export function dateInZone(instant, zone) {
  return civilDateInZone(instant, zone);
}
const initialReminders = () => [{daysBefore: 0, time: '08:00'}];
const oldGroups = {
  'guru-tsok':'tsok', 'dakini-tsok':'tsok', 'jigme-lingpa':'masters',
  longchenpa:'masters', 'jigme-phuntsok':'masters', mipham:'masters',
  'buddha-birth':'buddha', 'saga-dawa':'buddha', 'turning-wheel':'buddha', lhabab:'buddha'
};
export function defaults(catalog, zone = deviceTimeZone()) {
  zone = resolveTimeZone(zone);
  return {version: 2, zone, includeDailyDates: false, events: Object.fromEntries(catalog.events.map(e =>
    [e.id, {mode: 'off', reminders: initialReminders()}]))};
}
export function validateReminders(reminders) {
  if (!Array.isArray(reminders) || reminders.length < 1 || reminders.length > 2) throw new Error('请设置一至两次提醒。');
  const clean = reminders.map(r => {
    if (![0, 1, 2, 7].includes(r.daysBefore) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(r.time)) {
      throw new Error('请填写有效的提醒时间。');
    }
    return {daysBefore: r.daysBefore, time: r.time};
  });
  return [...new Map(clean.map(r => [`${r.daysBefore}-${r.time}`, r])).values()];
}
function cleanPreference(pref) {
  if (!pref || !Object.hasOwn(MODES, pref.mode)) throw new Error('请选择有效的日历添加方式。');
  return {mode: pref.mode, reminders: validateReminders(pref.reminders)};
}
export function normalizeSettings(raw, catalog) {
  const base = defaults(catalog, raw?.zone);
  if (!raw || ![1,2].includes(raw.version)) return base;
  base.includeDailyDates = raw.version === 2 && raw.includeDailyDates === true;
  for (const event of catalog.events) {
    // Only the ten events present in v1 inherit v1 group choices. Newly added
    // observances must never be selected by an old broad category setting.
    const pref = raw.version === 2 ? raw.events?.[event.id]
      : oldGroups[event.id] ? raw.overrides?.[event.id] || raw.groups?.[oldGroups[event.id]] : undefined;
    if (raw.version === 2 && !pref) base.events[event.id].mode = 'off';
    if (pref) {
      try { base.events[event.id] = cleanPreference(pref); }
      catch {
        if (Object.hasOwn(MODES, pref.mode)) base.events[event.id].mode = pref.mode;
      }
    }
  }
  return base;
}
export function validateSettings(raw, catalog) {
  const zone = resolveTimeZone(raw?.zone);
  if (!raw || raw.version !== 2 || !zone
      || !raw.events || typeof raw.events !== 'object' || Array.isArray(raw.events)) {
    throw new Error('日历设置格式无效，请刷新页面后重试。');
  }
  const ids = new Set(catalog.events.map(e => e.id));
  if (Object.hasOwn(raw, 'includeDailyDates') && typeof raw.includeDailyDates !== 'boolean') {
    throw new Error('每日藏历选项必须为开启或关闭。');
  }
  for (const id of Object.keys(raw.events)) if (!ids.has(id)) throw new Error('节日目录已更新，请刷新页面后重试。');
  return {version: 2, zone, includeDailyDates: raw.includeDailyDates === true, events: Object.fromEntries(catalog.events.map(e =>
    [e.id, raw.events[e.id] ? cleanPreference(raw.events[e.id]) : {mode: 'off', reminders: initialReminders()}]))};
}
export function eventPreference(event, settings) {
  return settings.events?.[event.id] || {mode: 'off', reminders: initialReminders()};
}
export function rangeEnd(start, months) {
  const d = new Date(start + 'T12:00:00Z'), day = d.getUTCDate();
  d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + months);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return addDays(d.toISOString().slice(0, 10), -1);
}
function occurrenceWindow(settings, {start, end} = {}) {
  if (!start || !end) {
    // Preview remains usable before manual timezone selection. This local date
    // fallback is only for the preview window; it never changes reminder zone.
    const now = new Date(), zone = resolveTimeZone(settings.zone) || deviceTimeZone();
    const today = zone ? dateInZone(now, zone) : `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
    start ||= addDays(today, -90);
    end ||= rangeEnd(today, 24);
  }
  return {start, end};
}
export function selectOccurrences(data, settings, range = {}) {
  const {start, end} = occurrenceWindow(settings, range);
  const definitions = new Map(data.catalog.events.map(e => [e.id, e]));
  return generateOccurrences(data, {start,end}).map(o => {
    const definition = definitions.get(o.eventId);
    return {...definition, ...o, id: definition.id, title: o.title || definition.title,
      preference: eventPreference(definition, settings)};
  }).filter(o => o.preference.mode !== 'off');
}

// The grid's festival selection remains separate from the optional everyday
// layer. Both browser exports and the service compose the same final calendar.
// The injectable selector preserves the service's isolated publication tests.
export function selectCalendarOccurrences(data, settings, range = {}, festivalSelector = selectOccurrences) {
  const window = occurrenceWindow(settings, range);
  const festivals = festivalSelector(data, settings, window);
  if (settings.includeDailyDates !== true) return festivals;
  return [...festivals, ...dailyDateOccurrences(window.start, window.end)]
    .sort((a, b) => a.date.localeCompare(b.date) || a.uid.localeCompare(b.uid));
}

// Resolve recurring wall-clock alarms with IANA rules. Like calendar-compatible
// disambiguation, choose the first repeated instant and shift a missing time by
// the DST gap. Future rolling windows must not fail because they encounter DST.
export function zonedInstant(date, time, zone) {
  const desired = `${date}T${time}:00`;
  const wanted = Date.parse(desired + 'Z');
  if (!Number.isFinite(wanted)) throw new Error('日期或时间无效。');
  const wall = ms => wallTimeInZone(ms, zone);
  const offsets = new Set([-36, 0, 36].map(h => {
    const probe = wanted + h * 3600000;
    return Date.parse(wall(probe) + 'Z') - probe;
  }));
  const candidates = [...offsets].map(offset => wanted - offset);
  const matches = candidates.filter(ms => wall(ms) === desired).sort((a,b)=>a-b);
  if (matches.length) return new Date(matches[0]);
  const shifted = candidates.filter(ms => wall(ms) > desired)
    .sort((a,b)=>wall(a).localeCompare(wall(b)) || a-b);
  if (shifted.length) return new Date(shifted[0]);
  throw new Error(`${date} ${time} 无法转换为有效的提醒时间。`);
}
// Keep the exact UTC instants used by publication hashing and serialization in
// one place. A runtime timezone-data update may change these without changing
// the user's wall-clock preference or the all-day festival date.
export function resolveAlarmInstants(event, zone) {
  if (event.kind === 'daily-date' || event.status === 'CANCELLED' || event.preference.mode !== 'remind') return [];
  return validateReminders(event.preference.reminders).map(reminder =>
    zonedInstant(addDays(event.date, -reminder.daysBefore), reminder.time, zone).toISOString());
}
function publishedAlarmInstants(event) {
  const expected = validateReminders(event.preference.reminders).length;
  const values = event.alarmInstants;
  if (!Array.isArray(values) || values.length !== expected || values.some(value => {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return true;
    const instant = new Date(value);
    return !Number.isFinite(instant.getTime()) || instant.toISOString() !== value;
  })) throw new Error('已发布的提醒时间无效，请稍后重试。');
  return values;
}
const stamp = date => date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
// All-day reminders are written relative to the event's civil midnight, the
// form Apple Calendar itself uses. Field tests (2026-11-08) showed Xiaomi
// Calendar turning absolute UTC triggers on all-day events into the UTC wall
// time (08:00 Beijing became 00:00, 20:15 became 12:15); the relative form rang
// at the chosen time. It follows the phone's own clock, so the selected zone
// only labels the page and the rolling window.
export function relativeTrigger(reminder) {
  const [hours, minutes] = reminder.time.split(':').map(Number);
  const offset = hours * 60 + minutes - reminder.daysBefore * 1440;
  return `TRIGGER:${offset < 0 ? '-' : ''}PT${Math.abs(offset)}M`;
}
export const escapeICS = value => String(value).replace(/\\/g, '\\\\').replace(/\r\n|\r|\n/g, '\\n').replace(/;/g, '\\;').replace(/,/g, '\\,');
export function foldLine(line) {
  // Fast path: 25 UTF-16 units can never exceed 75 UTF-8 bytes, and an ASCII
  // line is one byte per unit. Most ICS lines take this path unchanged.
  if (line.length <= 25 || (line.length <= 75 && /^[\x00-\x7f]*$/.test(line))) return line;
  let output = '', bytes = 0;
  for (const char of line) {
    // Count UTF-8 bytes without allocating a typed array for every character.
    const point = char.codePointAt(0);
    const size = point < 0x80 ? 1 : point < 0x800 ? 2 : point < 0x10000 ? 3 : 4;
    if (bytes + size > 75) { output += '\r\n '; bytes = 1; }
    output += char; bytes += size;
  }
  return output;
}
// One subscription shows one colour, so a short leading mark tells the three
// kinds apart in every calendar app: ◆ will remind, ◇ display-only festival,
// ◦ everyday Tibetan date. In apps that order an all-day list by title, these
// code points also sort reminders first and everyday dates last.
export const TITLE_MARKS = Object.freeze({remind: '◆', display: '◇', daily: '◦'});
export function markedTitle(event) {
  const mark = event.kind === 'daily-date' ? TITLE_MARKS.daily
    : event.preference?.mode === 'remind' ? TITLE_MARKS.remind : TITLE_MARKS.display;
  return `${mark} ${event.title}`;
}
export function exportICS(events, {zone, name = '慧灯·藏历修行日', generatedAt = new Date(), sourceVersion = '2026-10-20', usePublishedAlarmInstants = false} = {}) {
  zone = resolveTimeZone(zone);
  if (!zone) throw new Error('请选择有效的提醒时区。');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Huideng Vancouver//Practice Calendar 1.0//ZH',
    'CALSCALE:GREGORIAN', `X-WR-CALNAME:${escapeICS(name)}`, `X-WR-TIMEZONE:${zone}`];
  const ids = new Set();
  for (const event of events) {
    if (ids.has(event.uid)) throw new Error('日程标识重复。');
    ids.add(event.uid);
    const daily = event.kind === 'daily-date';
    const description = daily ? [event.description, ENGINE.url, '仅加入日历；请关闭此日历的默认通知。'] :
      [`藏历${event.tibetan}`, '日期换算：藏历 PRO；节日名称与安排：佛慧法语藏历。',
      `原站标注：${event.sourceLabel || event.title}`, event.source,
      event.preference.mode === 'remind' ? `提醒：${reminderLabel(event.preference.reminders)}（按手机当地时间）。提醒时间不代表共修开始时间。` : '仅加入日历；请关闭此日历的默认通知。'];
    const asDate = value => value instanceof Date ? value : new Date(value);
    const dtstamp = asDate(event.dtstamp || event.lastModified || event.createdAt || generatedAt);
    const status = event.status === 'CANCELLED' ? 'CANCELLED' : 'CONFIRMED';
    const sequence = Number.isSafeInteger(event.sequence) && event.sequence >= 0 ? event.sequence : 0;
    lines.push('BEGIN:VEVENT', `UID:${event.uid}@calendar.huidengvan.org`, `DTSTAMP:${stamp(dtstamp)}`,
      `DTSTART;VALUE=DATE:${event.date.replaceAll('-', '')}`,
      `DTEND;VALUE=DATE:${addDays(event.date, 1).replaceAll('-', '')}`,
      `SUMMARY:${escapeICS(markedTitle(event))}`, `DESCRIPTION:${escapeICS(description.join('\n'))}`,
      `URL:${daily ? ENGINE.url : event.source}`, `STATUS:${status}`, 'TRANSP:TRANSPARENT', `SEQUENCE:${sequence}`);
    if (event.createdAt) lines.push(`CREATED:${stamp(asDate(event.createdAt))}`);
    if (event.lastModified) lines.push(`LAST-MODIFIED:${stamp(asDate(event.lastModified))}`);
    if (!daily && status !== 'CANCELLED' && event.preference.mode === 'remind') {
      // Only the server explicitly opts into its own publication ledger. Direct
      // exports ignore arbitrary alarmInstants copied into browser event data.
      // Published instants are still validated: they keep the ledger honest and
      // detect timezone-data changes, even though the trigger itself is relative.
      if (usePublishedAlarmInstants) publishedAlarmInstants(event); else resolveAlarmInstants(event, zone);
      for (const reminder of [...new Map(validateReminders(event.preference.reminders)
        .map(reminder => [relativeTrigger(reminder), reminder])).values()]) {
        lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${escapeICS(event.title)}`,
          relativeTrigger(reminder), 'END:VALARM');
      }
    }
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(foldLine).join('\r\n') + '\r\n';
}
export function reminderLabel(reminders) {
  return reminders.map(r => `${r.daysBefore === 0 ? '当天' : `提前${r.daysBefore}天`} ${r.time}`).join('、');
}

// The everyday date layer is identical for every visitor, so it ships as one
// static file on the CDN: no Worker CPU, no personal data, no alarms. Its UIDs
// use a separate namespace so it can coexist with a feed that bundles them.
export const DAILY_CALENDAR_PATH = 'daily-dates.ics';
export function exportDailyCalendar(start, end) {
  const events = dailyDateOccurrences(start, end).map(event => ({...event, uid: `daily-only-${event.date}`}));
  return exportICS(events, {zone: 'UTC', name: '慧灯·每日藏历', generatedAt: new Date(`${start}T00:00:00Z`)});
}
