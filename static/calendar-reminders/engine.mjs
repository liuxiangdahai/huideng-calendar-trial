import {getZangli} from './vendor/zangli/zangli.mjs';

export const ENGINE = Object.freeze({name: '藏历 PRO', packageVersion: '0.2.0',
  commit: 'c29e60f8292473c038a1da7d5a4061a3c97026fa',
  url: 'https://github.com/stonelf/zangli',
  supported: {start: '1951-01-08', end: '2051-02-11'}});
const MONTHS = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二'];
const DAYS = ['', '初一', '初二', '初三', '初四', '初五', '初六', '初七', '初八', '初九', '初十',
  '十一', '十二', '十三', '十四', '十五', '十六', '十七', '十八', '十九', '二十',
  '廿一', '廿二', '廿三', '廿四', '廿五', '廿六', '廿七', '廿八', '廿九', '三十'];
const DAY_MS = 86400000;
const dateCache = new Map();
const shift = (date, days) => new Date(Date.parse(date + 'T12:00:00Z') + days * DAY_MS).toISOString().slice(0, 10);
function validateDate(date) {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      !Number.isFinite(Date.parse(date + 'T12:00:00Z')) ||
      new Date(date + 'T12:00:00Z').toISOString().slice(0, 10) !== date) {
    throw new RangeError('日期必须是有效的 YYYY-MM-DD。');
  }
  if (date < ENGINE.supported.start || date > ENGINE.supported.end) {
    throw new RangeError('藏历日期超出支持范围。');
  }
}
const yearName = year => '铁水木火土'[Math.floor((year - 1950) / 2) % 5] +
  '虎兔龙蛇马羊猴鸡狗猪鼠牛'[(year - 1950) % 12];

/** Gregorian civil date -> PRO Tibetan calendar date, independent of reminder timezone. */
export function getTibetanDate(date) {
  validateDate(date);
  if (dateCache.has(date)) return {...dateCache.get(date)};
  const [gregorianYear, month, day] = date.split('-').map(Number);
  // Both the upstream origin and the input use the runtime's civil date. An ISO
  // UTC-midnight string would move the day backwards in America/Vancouver.
  const raw = getZangli(new Date(gregorianYear, month - 1, day, 12));
  if (!raw || raw === 'error' || raw.value === 'error') throw new RangeError('无法换算藏历日期。');
  const tibetanMonth = MONTHS.indexOf(raw.month.replace(/^闰/, '').replace(/^正$/, '一'));
  const tibetanDay = DAYS.indexOf(raw.day.replace(/^闰/, ''));
  const year = [gregorianYear, gregorianYear - 1, gregorianYear + 1].find(y => yearName(y) === raw.year);
  if (!year || tibetanMonth < 1 || tibetanDay < 1) throw new RangeError('藏历引擎返回了无效日期。');
  const result = {year, yearName: raw.year, month: tibetanMonth, day: tibetanDay,
    monthLeap: raw.monthLeap, dayLeap: raw.dayLeap, dayMiss: raw.dayMiss,
    display: `${raw.monthLeap ? '闰' : ''}${MONTHS[tibetanMonth]}月${DAYS[tibetanDay]}`};
  if (dateCache.size >= 4096) dateCache.clear();
  dateCache.set(date, result);
  return {...result};
}

const sameMonth = (left, right) => left.year === right.year && left.month === right.month &&
  left.monthLeap === right.monthLeap;
const monthDayLabel = (month, day) => `${month.monthLeap ? '闰' : ''}${MONTHS[month.month]}月${DAYS[day]}`;

/** Omitted lunar slots between two adjacent real civil days, including month boundaries. */
export function omittedTibetanDays(previous, tibetan) {
  const missingBefore = [];
  const omitted = (month, start, end) => {
    for (let day = start; day <= end; day++) {
      const display = monthDayLabel(month, day);
      missingBefore.push({year: month.year, yearName: month.yearName, month: month.month,
        monthLeap: month.monthLeap, day, display, fullLabel: `藏历${month.yearName}年${display}`});
    }
  };
  if (previous) {
    if (sameMonth(previous, tibetan)) omitted(tibetan, previous.day + 1, tibetan.day - 1);
    else {
      // PRO's raw dayMiss flag alone cannot identify an omitted day 30 at the
      // end of the previous month/year. Compare the two real adjacent civil days.
      omitted(previous, previous.day + 1, 30);
      omitted(tibetan, 1, tibetan.day - 1);
    }
  }
  return missingBefore;
}

/** Shared civil-day detail for the month grid and the optional exported date layer. */
export function tibetanDayDetails(date) {
  const tibetan = getTibetanDate(date);
  const previous = date > ENGINE.supported.start ? getTibetanDate(shift(date, -1)) : null;
  const next = date < ENGINE.supported.end ? getTibetanDate(shift(date, 1)) : null;
  const repeatNumber = previous && sameMonth(previous, tibetan) && previous.day === tibetan.day ? 2
    : next && sameMonth(next, tibetan) && next.day === tibetan.day ? 1 : 0;
  const missingBefore = omittedTibetanDays(previous, tibetan);
  const fullLabel = `藏历${tibetan.yearName}年${tibetan.display}${repeatNumber ? `（重日${repeatNumber}）` : ''}`;
  const missingLabel = missingBefore.length ? `缺日：${missingBefore.map(day => day.fullLabel).join('、')}，已跳过。` : '';
  return {...tibetan, repeatNumber, missingBefore, missingLabel, fullLabel};
}

/** One display-only event per real Gregorian day; omitted days get no phantom event. */
export function dailyDateOccurrences(start, end) {
  validateDate(start); validateDate(end);
  if (start > end) throw new RangeError('结束日期不能早于开始日期。');
  const result = [];
  for (let date = start; date <= end; date = shift(date, 1)) {
    const day = tibetanDayDetails(date);
    result.push({id: 'daily-dates', eventId: 'daily-dates', kind: 'daily-date', origin: 'engine',
      uid: `daily-date-${date}`, date, title: `藏历${day.display}${day.repeatNumber ? `（重日${day.repeatNumber}）` : ''}`,
      tibetan: day.display, description: [day.fullLabel, day.missingLabel,
        '日期换算：藏历 PRO。每日藏历为全天记录，不设置提醒。'].filter(Boolean).join('\n'),
      source: ENGINE.url, sourceLabel: '藏历 PRO 日期换算', preference: {mode: 'display', reminders: []}});
  }
  return result;
}

function uidFor(definition, bucket) {
  // Keep v1's ten existing event identifiers and lunar-slot UIDs. A correction
  // to the Gregorian day or to the display title must not duplicate an event.
  const slot = definition.rule.kind === 'tibetan-monthly'
    ? `${bucket.monthLeap ? '闰' : ''}${MONTHS[bucket.month]}` : 'annual';
  return `${definition.id}-${bucket.year}-${slot}-1`;
}

/**
 * Inclusive date window. Published source records are authoritative throughout
 * their complete coverage; only explicit, reviewed fixed rules extend beyond it.
 * Ceremonies, astronomical events, equinoxes and solstices are never predicted.
 */
export function generateOccurrences(data, {start, end}) {
  validateDate(start); validateDate(end);
  if (start > end) throw new RangeError('结束日期不能早于开始日期。');
  if (!data?.catalog?.events) throw new TypeError('缺少节日目录。');
  const published = data.published || {records: [], coverage: null};
  const records = published.records || [];
  const publishedIds = new Set(records.map(r => r.uid));
  const coverage = published.coverage;
  const covered = date => coverage && date >= coverage.start && date <= coverage.end;
  const inWindow = date => date >= start && date <= end;
  const definitions = new Map(data.catalog.events.map(e => [e.id, e]));
  if (definitions.size !== data.catalog.events.length) throw new Error('节日标识重复。');
  if (publishedIds.size !== records.length) throw new Error('公布日程的标识重复。');

  const scanStart = shift(start, -35) < ENGINE.supported.start ? ENGINE.supported.start : shift(start, -35);
  const scanEnd = shift(end, 35) > ENGINE.supported.end ? ENGINE.supported.end : shift(end, 35);
  const buckets = new Map(), civilDates = new Map();
  for (let date = scanStart; date <= scanEnd; date = shift(date, 1)) {
    const tibetan = getTibetanDate(date);
    civilDates.set(date, tibetan);
    const key = `${tibetan.year}/${tibetan.month}/${Number(tibetan.monthLeap)}`;
    if (!buckets.has(key)) buckets.set(key, {...tibetan, dates: []});
    buckets.get(key).dates.push({date, ...tibetan});
  }
  const result = new Map();
  for (const definition of definitions.values()) {
    const rule = definition.rule;
    if (!rule) continue;
    if (!['tibetan-monthly', 'tibetan-annual'].includes(rule.kind) ||
        !Number.isInteger(rule.day) || rule.day < 1 || rule.day > 30 ||
        rule.missing !== 'previous' || rule.repeated !== 'first' ||
        (rule.kind === 'tibetan-annual' && (!Number.isInteger(rule.month) || rule.month < 1 || rule.month > 12))) {
      throw new Error(`无效的藏历节日规则：${definition.id}`);
    }
    for (const bucket of buckets.values()) {
      if (rule.kind === 'tibetan-annual' && bucket.month !== rule.month) continue;
      if (bucket.monthLeap && rule.leapMonth !== 'include') continue;
      let occurrence = bucket.dates.find(d => d.day === rule.day && !d.dayLeap);
      if (!occurrence) {
        // The following valid date proves a day was omitted. For an omitted day
        // 30, a following month proves the current month is complete. Do not
        // invent an occurrence at a truncated scan or engine-range boundary.
        const after = bucket.dates.find(d => d.day > rule.day);
        const nextMonth = civilDates.get(shift(bucket.dates.at(-1).date, 1));
        const monthComplete = nextMonth && (nextMonth.month !== bucket.month ||
          nextMonth.monthLeap !== bucket.monthLeap || nextMonth.year !== bucket.year);
        if (after || (rule.day === 30 && monthComplete)) {
          const priorDate = after ? shift(after.date, -1) : bucket.dates.at(-1).date;
          const prior = civilDates.get(priorDate);
          if (prior) occurrence = {date: priorDate, ...prior};
        }
      }
      if (!occurrence || !inWindow(occurrence.date)) continue;
      const uid = uidFor(definition, bucket);
      if (covered(occurrence.date) || publishedIds.has(uid)) continue;
      result.set(uid, {eventId: definition.id, uid, date: occurrence.date, tibetan: occurrence.display,
        title: definition.title, sourceLabel: definition.sourceLabel,
        source: 'https://www.fohuifayu.com/index.php/calendar', origin: 'rule'});
    }
  }
  for (const record of records) {
    if (!definitions.has(record.eventId)) throw new Error(`公布日程未归类：${record.eventId}`);
    if (!record.uid || !record.recordId || !record.title || !record.sourceLabel) throw new Error('公布日程资料不完整。');
    if (inWindow(record.date)) result.set(record.uid, {...record, origin: 'published'});
  }
  return [...result.values()].sort((a, b) => a.date.localeCompare(b.date) || a.eventId.localeCompare(b.eventId));
}
