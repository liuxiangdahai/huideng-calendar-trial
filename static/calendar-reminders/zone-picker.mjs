import {listTimeZones,zoneInfo,resolveTimeZone} from './timezones.mjs';
const esc = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const common = ['Asia/Shanghai','Asia/Hong_Kong','Asia/Taipei','Asia/Singapore','America/Vancouver','America/Toronto','America/New_York','America/Los_Angeles','Europe/London','Australia/Sydney','Asia/Kathmandu','UTC'];
export function createZonePicker(dialog,{onApply}) {
  const $ = selector => dialog.querySelector(selector);
  let selected='',current='',device='',zones=[];
  function render() {
    const query = $('#zone-search').value.trim().toLocaleLowerCase();
    const pinned = [...new Set([device,current,...common].map(resolveTimeZone).filter(Boolean))];
    const byId = new Map(zones.map(zone=>[zone.id,zone]));
    for (const id of pinned) if (!byId.has(id)) byId.set(id,zoneInfo(id));
    const ordered = [...pinned.map(id=>byId.get(id)),...zones.filter(zone=>!pinned.includes(zone.id))];
    const results = ordered.filter(zone=>!query || `${zone.label} ${zone.id} ${zone.offset} ${zone.search}`.toLocaleLowerCase().includes(query));
    $('#zone-options').innerHTML = results.map(zone=>`<label class="zone-option"><input type="radio" name="timezone" value="${esc(zone.id)}" ${selected===zone.id?'checked':''}><span class="zone-check" aria-hidden="true"></span><span><strong>${esc(zone.label)}</strong><small>${esc(zone.offset)} · ${esc(zone.id)}</small>${[zone.id===device?'设备时区':'',zone.id===current?'当前选择':'',pinned.includes(zone.id)&&zone.id!==device&&zone.id!==current?'常用地区':''].filter(Boolean).map(label=>`<em>${label}</em>`).join('')}</span></label>`).join('') || '<p class="empty">没有找到这个地区。请尝试城市名称或标准时区名称。</p>';
    $('#zone-result-status').textContent = query ? `找到 ${results.length} 个时区` : '手机所在、当前选择和常用地区排在前面。';
    $('#apply-zone').disabled = !selected;
  }
  $('#zone-search').addEventListener('input',()=>{dialog.classList.add('is-typing');render();});
  dialog.addEventListener('close',()=>dialog.classList.remove('is-typing'));
  $('#zone-options').addEventListener('change',event=>{if(event.target.name==='timezone'){selected=event.target.value;$('#apply-zone').disabled=false;}});
  $('#zone-form').addEventListener('submit',event=>{
    event.preventDefault(); const valid=resolveTimeZone(selected);
    if (!valid) {$('#zone-error').textContent='请选择有效的提醒时区。';$('#zone-error').hidden=false;return;}
    onApply(valid); dialog.close();
  });
  return {open({zone,deviceZone}) {
    current=resolveTimeZone(zone);selected=current;device=resolveTimeZone(deviceZone);zones=listTimeZones();
    $('#zone-search').value='';$('#zone-error').hidden=true;render();dialog.showModal();
    // Phones: no keyboard until the person taps the search box; it used to
    // pop up at once and squeeze the list out of sight (11-12). Show the
    // chosen zone instead. Computers keep the cursor in the search box.
    if(matchMedia('(pointer: coarse)').matches){ document.activeElement?.blur?.(); dialog.querySelector('.zone-option:has(input:checked)')?.scrollIntoView({block:'nearest'}); }
    else $('#zone-search').focus();
  }};
}
