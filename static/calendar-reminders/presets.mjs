import {cloneSettings} from './runtime.mjs';
export const PRESETS = [
  {id:'guru',title:'莲师荟供日',description:'每月莲师荟供日',reminder:'莲师荟供日',icon:'ritual-bell'},
  {id:'tsok',title:'两个荟供日',description:'莲师与空行母荟供日',reminder:'两个荟供日',icon:'bell-vajra'},
  {id:'practice',title:'全部修行日',description:'各类修行日与已收录日月食',reminder:'荟供日，其余仅显示',icon:'lotus'}
];
const tsokIds = new Set(['guru-tsok','dakini-tsok']);
const presetMode = (presetId,eventId) => presetId==='practice' && !tsokIds.has(eventId) ? 'display' : 'remind';
export function presetIds(catalog, id) {
  if (!PRESETS.some(preset=>preset.id===id)) throw new Error('请选择有效的快捷方案。');
  return catalog.events.filter(event=>id==='guru' ? event.id==='guru-tsok' : id==='tsok'
    ? ['guru-tsok','dakini-tsok'].includes(event.id)
    : ['tsok','buddha','masters','practice','festivals'].includes(event.group) || event.tags?.includes('eclipse')).map(event=>event.id);
}
export function applyPreset(settings,catalog,id) {
  const next=cloneSettings(settings), ids=new Set(presetIds(catalog,id));
  for (const event of catalog.events) {
    const pref=next.events[event.id];
    next.events[event.id]=ids.has(event.id)
      ? presetMode(id,event.id)==='display' ? {...pref,mode:'display'}
        : pref?.mode==='remind' ? pref : {mode:'remind',reminders:[{daysBefore:0,time:'08:00'}]}
      : {...pref,mode:'off'};
  }
  return next;
}
export function matchingPreset(settings,catalog) {
  return PRESETS.find(preset=>{
    const ids=new Set(presetIds(catalog,preset.id));
    return catalog.events.every(event=>settings.events[event.id]?.mode===(ids.has(event.id) ? presetMode(preset.id,event.id) : 'off'));
  })?.id || '';
}
