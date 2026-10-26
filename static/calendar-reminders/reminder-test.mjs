import {foldLine} from './core.mjs';
const stamp = date => date.toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,'');
// Keep the actual instant, even when the next ten minutes cross a repeated DST hour.
export function reminderTestICS(now = new Date()) {
  const at=new Date(now.getTime()+10*60000), end=new Date(at.getTime()+5*60000);
  const lines=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Huideng//Reminder test//ZH','CALSCALE:GREGORIAN','X-WR-CALNAME:慧灯藏历提醒测试','BEGIN:VEVENT',`UID:test-${now.getTime()}@calendar.huidengvan.org`,`DTSTAMP:${stamp(now)}`,`DTSTART:${stamp(at)}`,`DTEND:${stamp(end)}`,'SUMMARY:慧灯藏历 · 提醒测试（可删除）','DESCRIPTION:请在测试后删除此日程。测试通过不代表订阅自动更新或每项提醒均已通过验收。','BEGIN:VALARM','ACTION:DISPLAY','DESCRIPTION:慧灯藏历提醒测试',`TRIGGER;VALUE=DATE-TIME:${stamp(at)}`,'END:VALARM','END:VEVENT','END:VCALENDAR'];
  return {at,content:lines.map(foldLine).join('\r\n')+'\r\n'};
}
