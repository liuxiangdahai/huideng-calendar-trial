// Shared, side-effect-free parsing and comparison for 佛慧法语 month pages.
// Pages are read as text only; source HTML is never executed.
import crypto from 'node:crypto';
import {getTibetanDate} from '../../static/calendar-reminders/engine.mjs';

const decode = value => value.replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'")
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
  .replace(/&amp;/g, '&').replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n));
const text = value => decode(value).replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]*>/g, '').trim();
const pad = value => String(value).padStart(2, '0');
const shiftDay = (date, days) => new Date(Date.parse(date) + days * 86400000).toISOString().slice(0, 10);

export const monthURL = (year, month) => `https://www.fohuifayu.com/index.php/calendar/monthcalendar/${year}/${month}/-`;
export const monthFile = name => name.match(/^fohui-(\d{4})-(\d{1,2})\.html$/)?.slice(1).map(Number) || null;

export function parseMonthPage(html, year, month) {
  const url = monthURL(year, month), days = [];
  for (const cell of html.matchAll(/<td\b[^>]*class="cal_dayshasevents\b[^"]*"[^>]*>([\s\S]*?)<\/td>/g)) {
    const dayMatch = cell[1].match(/class="cal_daylink">\s*(\d+)/);
    const info = cell[1].match(/class="eventfull[^"]*"[^>]*title="([^"]*)"[^>]*data-content="([^"]*)"/);
    if (!dayMatch || !info) throw new Error(`无法识别 ${year}年${month}月 的日期格式。`);
    const date = `${year}-${pad(month)}-${pad(dayMatch[1])}`;
    const tibetan = text(info[1]).replace(/^藏历[：:]\s*/, '');
    const labels = text(info[2]).split(/\n/).map(s => s.trim()).filter(Boolean);
    if (!tibetan.includes('月')) throw new Error(`缺少藏历日期：${date}`);
    days.push({date, tibetan, labels, source: url});
  }
  return {days, snapshot: {url, sha256: crypto.createHash('sha256').update(html).digest('hex'), days: days.length}};
}

// A downloaded month must start on day 1 and be contiguous. Only the newest
// month may stop early (the source has not published further yet); a short or
// empty page elsewhere is a fetch problem, never evidence of a withdrawal.
export function assertCompleteMonth(days, year, month, {allowTrailing = false} = {}) {
  const expected = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const numbers = [...new Set(days.map(day => Number(day.date.slice(8))))].sort((a, b) => a - b);
  const contiguous = numbers.length && numbers[0] === 1 && numbers.every((n, i) => n === i + 1) && numbers.length === days.length;
  if (!contiguous || (!allowTrailing && numbers.length !== expected)) {
    throw new Error(`${year}年${month}月 只有 ${numbers.length}/${expected} 天，请重新保存完整月份页面。`);
  }
}

function labelIndex(catalog) {
  const map = new Map();
  for (const definition of catalog.events) for (const label of definition.sourceLabels || [definition.sourceLabel]) map.set(label, definition);
  return map;
}

// Compare saved month pages with the confirmed source. 佛慧法语 is the only
// authority for names and arrangements; this function records what changed so
// a maintainer can review it, and keeps stable record IDs across corrections.
export function diffSource({existing, incoming, catalog, ledger, moveWindowDays = 40}) {
  const labels = labelIndex(catalog), old = new Map(existing.days.map(day => [day.date, day]));
  const changes = [], removed = [], added = [];
  const incomingDates = new Set(incoming.map(day => day.date)), months = new Set(incoming.map(day => day.date.slice(0, 7)));
  const lost = existing.days.filter(day => months.has(day.date.slice(0, 7)) && !incomingDates.has(day.date));
  if (lost.length) changes.push({kind: 'coverage-shrink', blocking: true, from: lost[0].date, to: lost.at(-1).date});
  for (const day of incoming) {
    const before = old.get(day.date);
    if (getTibetanDate(day.date).display !== day.tibetan) changes.push({kind: 'pro-mismatch', blocking: true, date: day.date, source: day.tibetan, pro: getTibetanDate(day.date).display});
    if (before && before.tibetan !== day.tibetan) changes.push({kind: 'tibetan-date', blocking: true, date: day.date, before: before.tibetan, after: day.tibetan});
    for (const label of day.labels) if (!labels.has(label)) changes.push({kind: 'unmapped-label', blocking: true, date: day.date, label});
    const previous = new Set(before?.labels || []), next = new Set(day.labels);
    for (const label of next) if (!previous.has(label) && labels.has(label)) added.push({date: day.date, label});
    for (const label of previous) if (!next.has(label)) removed.push({date: day.date, label});
  }
  // A published-only label that disappears near where the same label appears is a
  // correction of one occurrence (改期): it keeps its recordId and UID.
  for (const gone of removed) {
    const definition = labels.get(gone.label);
    const record = ledger.records.find(r => r.date === gone.date && r.sourceLabel === gone.label);
    const target = added.filter(item => item.label === gone.label && !item.matched)
      .map(item => ({item, distance: Math.abs(Date.parse(item.date) - Date.parse(gone.date)) / 86400000}))
      .filter(entry => entry.distance <= moveWindowDays).sort((a, b) => a.distance - b.distance)[0];
    if (definition?.rule) {
      if (target) target.item.matched = true;
      changes.push({kind: 'observance-shift', blocking: false, label: gone.label, from: gone.date, to: target?.item.date || null});
    } else if (target) {
      target.item.matched = true;
      changes.push({kind: 'moved', blocking: false, label: gone.label, eventId: definition?.eventId || definition?.id, from: gone.date, to: target.item.date, recordId: record?.recordId || null});
    } else {
      changes.push({kind: 'removed', blocking: true, label: gone.label, date: gone.date, recordId: record?.recordId || null});
    }
  }
  for (const item of added) {
    if (item.matched) continue;
    const definition = labels.get(item.label);
    changes.push(definition.rule
      ? {kind: 'observance-added', blocking: false, label: item.label, date: item.date}
      : {kind: 'added', blocking: false, label: item.label, eventId: definition.id, date: item.date});
  }
  return changes;
}

// Merge reviewed changes. Coverage must stay contiguous; ledger IDs are never reused.
export function mergeSource({existing, incoming, snapshots, ledger, changes, retrievedOn, acceptRemovals = false}) {
  const blocking = changes.filter(change => change.blocking && !(acceptRemovals && change.kind === 'removed'));
  if (blocking.length) throw new Error(`有 ${blocking.length} 项需要人工核对，未合并：${blocking.map(c => c.kind).join('、')}`);
  const days = new Map(existing.days.map(day => [day.date, day]));
  for (const day of incoming) days.set(day.date, day);
  const merged = [...days.values()].sort((a, b) => a.date.localeCompare(b.date));
  for (let i = 1; i < merged.length; i++) {
    if (shiftDay(merged[i - 1].date, 1) !== merged[i].date) throw new Error(`合并后在 ${merged[i - 1].date} 之后缺日，请补齐中间月份。`);
  }
  const snapshotMap = new Map(existing.snapshots.map(s => [s.url, s]));
  for (const snapshot of snapshots) snapshotMap.set(snapshot.url, snapshot);
  const records = ledger.records.map(record => ({...record}));
  const withdrawn = [...(ledger.withdrawn || [])];
  const used = [...records, ...withdrawn].map(r => Number(r.recordId.match(/(\d+)$/)?.[1] || 0));
  let nextId = Math.max(0, ...used) + 1;
  for (const change of changes) {
    if (change.kind === 'moved' && change.recordId) records.find(r => r.recordId === change.recordId).date = change.to;
    if (change.kind === 'added') {
      change.recordId = `fohui-${String(nextId++).padStart(5, '0')}`;
      records.push({recordId: change.recordId, eventId: change.eventId, date: change.date, sourceLabel: change.label});
    }
    if (change.kind === 'removed' && change.recordId) {
      const index = records.findIndex(r => r.recordId === change.recordId);
      withdrawn.push({...records[index], withdrawnOn: retrievedOn});
      records.splice(index, 1);
    }
  }
  records.sort((a, b) => a.date.localeCompare(b.date) || a.recordId.localeCompare(b.recordId));
  return {
    source: {...existing, retrievedOn, start: merged[0].date, end: merged.at(-1).date,
      snapshots: [...snapshotMap.values()].sort((a, b) => a.url.localeCompare(b.url, 'en', {numeric: true})), days: merged},
    ledger: {...ledger, records, ...(withdrawn.length ? {withdrawn} : {})}
  };
}
