import fs from 'node:fs';
import {exportICS, addDays} from '../../static/calendar-reminders/core.mjs';
import {ENGINE, getTibetanDate, generateOccurrences} from '../../static/calendar-reminders/engine.mjs';

const source = JSON.parse(fs.readFileSync('data/calendar/fohui-dates.json', 'utf8'));
const catalog = JSON.parse(fs.readFileSync('data/calendar/catalog.json', 'utf8'));
const ledger = JSON.parse(fs.readFileSync('data/calendar/published-record-ids.json', 'utf8'));
const sourceLabels = new Set(source.days.flatMap(d => d.labels));
const labelMap = new Map(), definitions = new Map();
for (const definition of catalog.events) {
  if (definitions.has(definition.id)) throw new Error('Duplicate catalog event ID: ' + definition.id);
  if (!catalog.groups.some(g => g.id === definition.group)) throw new Error('Unknown category: ' + definition.group);
  definitions.set(definition.id, definition);
  for (const label of definition.sourceLabels || [definition.sourceLabel]) {
    if (labelMap.has(label)) throw new Error('Source label has more than one category: ' + label);
    labelMap.set(label, definition);
  }
}
for (const label of sourceLabels) if (!labelMap.has(label)) throw new Error('Unmapped source label: ' + label);
if (new Set(ledger.records.map(r => r.recordId)).size !== ledger.records.length) throw new Error('Published record IDs are duplicated');
for (let i = 0; i < source.days.length; i++) {
  const day = source.days[i];
  if (i && addDays(source.days[i - 1].date, 1) !== day.date) throw new Error('Source coverage has a gap');
  // A disagreement must be reviewed rather than silently publishing a new
  // underlying calendar. Event-date corrections remain in published records.
  if (getTibetanDate(day.date).display !== day.tibetan) {
    throw new Error('PRO / source calendar mismatch on ' + day.date + '; review calendar correction before publishing');
  }
}
const candidates = generateOccurrences({catalog}, {start: addDays(source.start, -35), end: addDays(source.end, 35)});
const occurrences = [], usedLedger = new Set();
for (const day of source.days) {
  for (const label of day.labels) {
    const definition = labelMap.get(label);
    let uid, recordId;
    if (definition.rule) {
      const nearby = candidates.filter(o => o.eventId === definition.id)
        .map(o => ({...o, distance: Math.abs(Date.parse(o.date) - Date.parse(day.date)) / 86400000}))
        .filter(o => o.distance <= 7).sort((a, b) => a.distance - b.distance);
      if (!nearby.length || (nearby[1] && nearby[0].distance === nearby[1].distance)) {
        throw new Error('Cannot assign a stable lunar slot to ' + label + ' on ' + day.date);
      }
      uid = nearby[0].uid;
      recordId = 'observance-' + uid;
    } else {
      const matches = ledger.records.filter(r => r.eventId === definition.id && r.date === day.date && r.sourceLabel === label);
      if (matches.length !== 1) {
        throw new Error('Register this published occurrence with a stable ID (or preserve its existing ID when corrected): ' + day.date + ' ' + label);
      }
      recordId = matches[0].recordId;
      usedLedger.add(recordId);
      uid = definition.id + '-' + recordId;
    }
    occurrences.push({eventId: definition.id, recordId, uid, date: day.date, tibetan: day.tibetan,
      title: label, sourceLabel: label, source: day.source, origin: 'published'});
  }
}
if (new Set(occurrences.map(o => o.uid)).size !== occurrences.length) throw new Error('Source observations have duplicate UIDs');
for (const record of ledger.records) {
  if (record.date >= source.start && record.date <= source.end && !usedLedger.has(record.recordId)) {
    throw new Error('Previously registered published event disappeared; review cancellation: ' + record.recordId);
  }
}
for (const definition of catalog.events) {
  if (!occurrences.some(o => o.eventId === definition.id)) throw new Error('No verified dates for ' + definition.id);
}
const coverage = {start: source.start, end: source.end};
const data = {schemaVersion: 2, sourceName: source.sourceName, updatedOn: source.retrievedOn,
  engine: ENGINE, catalog, published: {coverage, records: occurrences},
  coverage, occurrences, dates: source.days.map(({date, tibetan}) => ({date, tibetan})),
  sourceLabelCount: sourceLabels.size};
// Legacy published occurrences remain available for audit and fixed public
// feeds. Personalized subscriptions call generateOccurrences for their rolling
// window; the UI must not use this archival list as its date-range limit.
const root = 'static/calendar-reminders';
fs.mkdirSync(root + '/feeds', {recursive: true});
fs.writeFileSync(root + '/calendar-data.json', JSON.stringify(data) + '\n');
for (const group of catalog.groups) {
  const events = occurrences.filter(o => definitions.get(o.eventId).group === group.id)
    .map(o => ({...definitions.get(o.eventId), ...o, preference: {mode: 'display'}}));
  fs.writeFileSync(root + '/feeds/' + group.id + '.ics', exportICS(events, {
    zone: 'Asia/Shanghai', name: '慧灯·' + group.name + '（仅展示）',
    generatedAt: new Date(source.retrievedOn + 'T00:00:00Z'), sourceVersion: source.retrievedOn
  }));
}
fs.writeFileSync(root + '/feeds/manifest.json', JSON.stringify({schemaVersion: 2, updatedOn: data.updatedOn, coverage,
  feeds: catalog.groups.map(g => ({id: g.id, title: g.name, url: g.id + '.ics', mode: 'display'}))}, null, 2) + '\n');
console.log('Built ' + occurrences.length + ' source observations across ' + catalog.events.length +
  ' selectable events; all ' + sourceLabels.size + ' distinct source labels mapped.');
