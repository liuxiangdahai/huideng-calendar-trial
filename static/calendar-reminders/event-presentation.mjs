import {icon} from './icons.mjs';

// One presentation vocabulary for choices, month markers and complete cards.
// Classification never alters the original title supplied by the calendar.
const groups = {
  tsok: ['荟供日', 'bell-vajra'],
  buddha: ['佛菩萨殊胜日', 'lotus'],
  masters: ['上师纪念日', 'throne'],
  practice: ['法会与修行月', 'pecha'],
  festivals: ['藏历节庆', 'festival'],
  nature: ['节气与天象', 'sun-moon'],
  other: ['其他纪念日', 'bookmark']
};

export function eventPresentation(event = {}, catalog) {
  const definition = catalog?.events?.find(item => item.id === (event.eventId || event.id));
  const groupId = event.group || definition?.group || 'other';
  const group = catalog?.groups?.find(item => item.id === groupId);
  const [fallbackLabel, fallbackIcon] = groups[groupId] || groups.other;
  const type = event.kind || event.subtype || definition?.kind || definition?.subtype;
  const eclipse = groupId === 'nature' && (type === 'eclipse' || event.tags?.includes('eclipse') ||
    definition?.tags?.includes('eclipse') || /[日月](?:全|偏|环)?食/.test(event.title || definition?.title || ''));
  return {groupId, label: eclipse ? '日月食' : group?.name || fallbackLabel,
    icon: eclipse ? 'eclipse' : groupId === 'tsok' && (event.eventId || event.id)
      ? (event.eventId || event.id) === 'guru-tsok' ? 'ritual-bell' : 'vajra' : fallbackIcon,
    colorClass: `event-category-${eclipse ? 'eclipse' : Object.hasOwn(groups, groupId) ? groupId : 'other'}`};
}

export function eventIcon(event, catalog) {
  return icon(eventPresentation(event, catalog).icon);
}
