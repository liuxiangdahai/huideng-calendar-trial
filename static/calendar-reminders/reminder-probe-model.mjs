import {dateInZone, addDays, zonedInstant} from './core.mjs';
import {wallTimeInZone} from './timezones.mjs';

export const PROBE_HOURS = 72;
export const PROBE_CASES = [
  {id:'a', label:'A · 全天日程', detail:'与正式订阅相同的提醒写法', minutes:[0], variant:'absolute'},
  {id:'b', label:'B · 全天日程对照', detail:'相对提醒；测试时保持手机与所选时区一致', minutes:[3], variant:'relative'},
  {id:'c', label:'C · 定时日程对照', detail:'仅用于诊断，不改变正式修行日的全天显示', minutes:[6], variant:'timed'},
  {id:'d', label:'D · 两次提醒', detail:'应分别收到两次通知', minutes:[9,12], variant:'absolute'},
  {id:'e', label:'E · 仅显示', detail:'不应收到通知', minutes:[], variant:'absolute'},
  {id:'f', label:'F · 每日藏历对照', detail:'不应收到通知', minutes:[], variant:'absolute'}
];
export const probeExpiry = probe => new Date(Date.parse(probe.anchor) + PROBE_HOURS * 3600000).toISOString();
export function probeSchedule(settings) {
  const probe = settings.reminderProbe;
  return PROBE_CASES.map(item => {
    const instants = item.minutes.map(min => new Date(Date.parse(probe.startAt) + min * 60000).toISOString());
    const last = instants.at(-1) || probe.startAt;
    const date = dateInZone(new Date(last), settings.zone);
    const reminders = instants.map(instant => ({
      daysBefore: Math.round((Date.parse(date) - Date.parse(dateInZone(new Date(instant), settings.zone))) / 86400000),
      time: wallTimeInZone(new Date(instant).getTime(), settings.zone).slice(11,16)
    }));
    return {...item, date, instants, reminders, omitted:probe.omit.includes(item.id),
      quiet: !instants.length || probe.silent.includes(item.id)};
  });
}
export function makeProbeSettings(zone, now = new Date()) {
  const anchor = new Date(Math.ceil(now.getTime() / 60000) * 60000).toISOString();
  return {version:2, zone, includeDailyDates:false, events:{}, reminderProbe:{version:1, anchor,
    startAt:new Date(Date.parse(anchor) + 30 * 60000).toISOString(), round:1, omit:[], silent:[]}};
}
export function nextMorning(settings, now = new Date()) {
  return zonedInstant(addDays(dateInZone(now, settings.zone),1),'08:00',settings.zone).toISOString();
}
