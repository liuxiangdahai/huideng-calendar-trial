import {resolveTimeZone,zoneInfo,wallTimeInZone} from './timezones.mjs';

const pad=value=>String(value).padStart(2,'0');
const localWall=now=>`${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
export function timeComparison(now,deviceZone,reminderZone,{deviceWall=localWall(now)}={}) {
  const device=resolveTimeZone(deviceZone), reminder=resolveTimeZone(reminderZone);
  const local={label:device ? zoneInfo(device,now).label : '设备当地',date:deviceWall.slice(0,10),time:deviceWall.slice(11,16)};
  if (!reminder) return {device:local,reminder:null,merged:false};
  const wall=wallTimeInZone(now,reminder), date=wall.slice(0,10);
  const days=Math.round((Date.parse(date+'T12:00:00Z')-Date.parse(local.date+'T12:00:00Z'))/86400000);
  return {device:local,merged:device===reminder,reminder:{label:zoneInfo(reminder,now).label,date,time:wall.slice(11,16),
    dayLabel:days===-1?'前一天':days===1?'后一天':days===0?'':days<0?`前${-days}天`:`后${days}天`}};
}
