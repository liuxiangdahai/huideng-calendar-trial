import {TIME_ZONE_LABELS, TIME_ZONE_ALIASES} from './timezone-data.mjs';
import {TIME_ZONE_CORRECTIONS} from './timezone-rules.mjs';

// Keep named places in zone.tab (including places that currently share rules).
// Only deprecated aliases are folded; choosing Bratislava must not show Prague.
const names = new Map(Object.keys(TIME_ZONE_LABELS).map(id => [id.toLowerCase(), id]));
for (const [alias, id] of Object.entries(TIME_ZONE_ALIASES)) names.set(alias.toLowerCase(), id);
const validZones = new Map();
const displayNames = {'Asia/Shanghai':'北京时间','Asia/Singapore':'新加坡时间','Asia/Hong_Kong':'香港时间',
  'Asia/Taipei':'台湾时间','Asia/Tokyo':'日本时间','Asia/Seoul':'韩国时间','UTC':'协调世界时'};
export function resolveTimeZone(value) {
  if (typeof value !== 'string' || value.length > 96) return '';
  const clean = value.trim();
  if (!/^[A-Za-z][A-Za-z0-9_+\/-]*$/.test(clean)) return '';
  if (validZones.has(clean)) return validZones.get(clean);
  let id = names.get(clean.toLowerCase()) || clean;
  try {
    const runtimeId = new Intl.DateTimeFormat('en', {timeZone: id}).resolvedOptions().timeZone;
    if (!Object.hasOwn(TIME_ZONE_LABELS, id)) id = names.get(runtimeId.toLowerCase()) || runtimeId;
  } catch { id = ''; }
  if (validZones.size >= 512) validZones.clear();
  validZones.set(clean, id);
  return id;
}

export function deviceTimeZone() {
  try { return resolveTimeZone(new Intl.DateTimeFormat().resolvedOptions().timeZone); }
  catch { return ''; }
}

const offsetFormatters = new Map();
function correctedOffset(id, instant) {
  const correction = TIME_ZONE_CORRECTIONS[id];
  return correction && Number(instant) >= correction.from ? correction.minutes : null;
}
function offsetLabel(minutes) {
  return `UTC${minutes < 0 ? '-' : '+'}${String(Math.floor(Math.abs(minutes)/60)).padStart(2, '0')}:${String(Math.abs(minutes)%60).padStart(2, '0')}`;
}
function currentOffset(id, instant) {
  const correction = correctedOffset(id, instant);
  if (correction !== null) return offsetLabel(correction);
  let formatter = offsetFormatters.get(id);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en', {timeZone: id, timeZoneName: 'longOffset'});
    if (offsetFormatters.size >= 64) offsetFormatters.clear();
    offsetFormatters.set(id, formatter);
  }
  return (formatter.formatToParts(instant).find(p => p.type === 'timeZoneName')?.value || 'GMT')
    .replace(/^GMT$/, 'UTC+00:00').replace(/^GMT/, 'UTC');
}

const wallFormatters = new Map();
export function wallTimeInZone(instant, zone) {
  const id = resolveTimeZone(zone);
  if (!id) throw new Error('请选择有效的提醒时区。');
  const correction = correctedOffset(id, instant);
  if (correction !== null) return new Date(Number(instant) + correction * 60000).toISOString().slice(0, 19);
  let formatter = wallFormatters.get(id);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-CA', {timeZone: id, hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit'});
    if (wallFormatters.size >= 16) wallFormatters.clear();
    wallFormatters.set(id, formatter);
  }
  const p = Object.fromEntries(formatter.formatToParts(new Date(Number(instant))).map(x => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}`;
}
export const civilDateInZone = (instant, zone) => wallTimeInZone(instant, zone).slice(0, 10);

export function zoneInfo(zone, instant = new Date()) {
  const id = resolveTimeZone(zone);
  if (!id) return {id: '', label: '请选择提醒时区', offset: '', search: ''};
  const offset = currentOffset(id, instant);
  const [country, city] = TIME_ZONE_LABELS[id] || (id.startsWith('Etc/')
    ? ['全球', '固定时区'] : ['其他地区', '设备支持的时区']);
  const label = displayNames[id] || `${country} · ${city}`;
  const aliases = Object.entries(TIME_ZONE_ALIASES).filter(([, target]) => target === id).map(([alias]) => alias);
  return {id, label, country, city, offset,
    search: [label, country, city, id, id.replaceAll('_', ' '), offset, ...aliases,
      id === 'Asia/Shanghai' ? '北京 中国大陆 Beijing China' : ''].join(' ').toLowerCase()};
}

// Offsets are derived at the supplied instant, not copied into the metadata.
// Cache only one minute so an open chooser refreshes at an actual DST boundary.
let listCache;
export function listTimeZones(instant = new Date()) {
  const minute = Math.floor(instant.getTime() / 60000);
  if (listCache?.minute === minute) return listCache.zones.map(zone => ({...zone}));
  const zones = Object.keys(TIME_ZONE_LABELS).filter(id => resolveTimeZone(id))
    .map(id => zoneInfo(id, instant)).sort((a, b) => a.label.localeCompare(b.label, 'zh-Hans'));
  listCache = {minute, zones};
  return zones.map(zone => ({...zone}));
}

// Compatibility export for callers that only need labels, without eagerly
// constructing hundreds of Intl formatters in the subscription Worker.
export const ZONE_LABELS = Object.entries(TIME_ZONE_LABELS).map(([id, [country, city]]) => [id, displayNames[id] || `${country} · ${city}`]);
