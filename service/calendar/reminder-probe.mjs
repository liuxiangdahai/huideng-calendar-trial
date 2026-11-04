// This adapter is enabled only in the isolated acceptance build. All records
// still use the normal service's auth, ledger, concurrency guard and snapshots.
import * as core from '../../static/calendar-reminders/core.mjs';
import {dailyDateOccurrences} from '../../static/calendar-reminders/engine.mjs';
import {PROBE_CASES, probeExpiry, probeSchedule} from '../../static/calendar-reminders/reminder-probe-model.mjs';

const stamp = value => new Date(value).toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,'');
const iso = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
export function reminderProbeAdapters({enabled = false, now = () => new Date()} = {}) {
  return {
    validateSettings(raw, catalog) {
      const normal = core.validateSettings(raw,catalog);
      if (!Object.hasOwn(raw,'reminderProbe')) return normal;
      if (!enabled) throw new Error('提醒对照测试仅在隔离验收站开放。');
      const p = raw.reminderProbe;
      if (!p || p.version !== 1 || !iso(p.anchor) || !iso(p.startAt) ||
          Date.parse(p.anchor) % 60000 || Date.parse(p.startAt) % 60000 ||
          !Number.isInteger(p.round) || p.round < 1 || p.round > 20 ||
          Date.parse(p.startAt) < Date.parse(p.anchor) || Date.parse(p.startAt) + 12*60000 >= Date.parse(probeExpiry(p))) {
        throw new Error('测试时间无效，请重新安排，测试有效期为三天。');
      }
      const clean = field => {
        if (!Array.isArray(p[field]) || p[field].length > 6 || p[field].some(id => !PROBE_CASES.some(item=>item.id===id))) throw new Error('测试项目无效。');
        return [...new Set(p[field])].sort();
      };
      if (normal.includeDailyDates || Object.values(normal.events).some(p=>p.mode !== 'off')) throw new Error('测试订阅不能混入真实修行日。');
      return {...normal, reminderProbe:{version:1,anchor:p.anchor,startAt:p.startAt,round:p.round,omit:clean('omit'),silent:clean('silent')}};
    },
    validateMutation(settings, previous, time) {
      const p = settings.reminderProbe, old = previous?.reminderProbe;
      if (!p && !old) return;
      if (!p || (previous && !old) || (old && (old.anchor !== p.anchor || previous.zone !== settings.zone))) throw new Error('测试类型、起点和时区不能修改；请另建测试。');
      if (!old && (Math.abs(Date.parse(p.anchor)-time.getTime()) > 5*60000 || Date.parse(p.startAt) < time.getTime()+10*60000)) throw new Error('请校准设备时间并至少预留十分钟添加测试订阅。');
      if (Date.parse(probeExpiry(p)) <= time.getTime()) throw new Error('测试已到期，请另建测试。');
      if (old && old.startAt !== p.startAt && Date.parse(p.startAt) < time.getTime()+10*60000) throw new Error('请至少预留十分钟等待日历同步。');
    },
    selectOccurrences(data,settings,range) {
      const p = settings.reminderProbe;
      if (!p) return core.selectOccurrences(data,settings,range);
      if (!enabled || now().getTime() >= Date.parse(probeExpiry(p))) return [];
      return probeSchedule(settings).filter(item=>!item.omitted).map(item=>{
        const daily = item.id === 'f' ? dailyDateOccurrences(item.date,item.date)[0] : null;
        return {...(daily || {}), id:`probe-${item.id}`,eventId:`probe-${item.id}`,uid:`reminder-probe-${item.id}`,
          title:`慧灯测试 ${item.id.toUpperCase()} · 第${p.round}轮 · ${daily?.title || item.label.slice(4)}`,
          date:item.date,tibetan:daily?.tibetan || '提醒对照测试（非真实节日）',
          description:'提醒对照测试，非真实节日。测试结束请移除此日历。',
          source:'https://huideng-calendar-acceptance.pages.dev/calendar-reminders/reminder-check.html',
          sourceLabel:'提醒对照测试，非真实节日',
          preference:{mode:item.quiet?'display':'remind',reminders:item.reminders.length?item.reminders:[{daysBefore:0,time:'08:00'}]},
          probe:{variant:item.variant,startAt:item.instants[0] || p.startAt,round:p.round}};
      });
    },
    exportICS(events, options) {
      // Baseline A/D/E/F is the exact production serializer. B and C change
      // only the properties under investigation, after the same publication.
      const text = core.exportICS(events,options);
      if (!enabled || !events.some(e=>e.probe)) return text;
      const indexed = new Map(events.map(e=>[`${e.uid}@calendar.huidengvan.org`,e]));
      return text.replace('X-WR-CALNAME:慧灯藏历\r\n','X-WR-CALNAME:慧灯提醒测试（请勿作为正式日历）\r\n')
        .replace(/BEGIN:VEVENT\r\n[\s\S]*?END:VEVENT\r\n/g,block=>{
          const event = indexed.get(block.match(/\r\nUID:([^\r]+)/)?.[1]);
          if (!event?.probe) return block;
          if (event.probe.variant === 'timed') {
            block = block.replace(/^DTSTART;VALUE=DATE:[^\r\n]*\r\n/m,`DTSTART:${stamp(event.probe.startAt)}\r\n`)
              .replace(/^DTEND;VALUE=DATE:[^\r\n]*\r\n/m,`DTEND:${stamp(Date.parse(event.probe.startAt)+5*60000)}\r\n`)
              .replace(/^TRIGGER;VALUE=DATE-TIME:[^\r\n]*\r\n/gm,'TRIGGER:PT0S\r\n');
          } else if (event.probe.variant === 'relative' && event.preference.mode === 'remind' && event.status !== 'CANCELLED') {
            // DATE-relative alarms follow the client's timezone, not a fixed
            // UTC instant. This is an experiment, never a production fallback.
            const r=event.preference.reminders[0], [h,m]=r.time.split(':').map(Number);
            const minutes=h*60+m-r.daysBefore*1440;
            block=block.replace(/^TRIGGER;VALUE=DATE-TIME:[^\r\n]*\r\n/gm,`TRIGGER:${minutes<0?'-':''}PT${Math.abs(minutes)}M\r\n`);
          }
          return block;
        });
    }
  };
}
