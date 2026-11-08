import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseMonthPage, assertCompleteMonth, diffSource, mergeSource} from '../../tools/calendar/fohui-source.mjs';
import {getTibetanDate} from '../../static/calendar-reminders/engine.mjs';

const read = file => JSON.parse(readFileSync(file, 'utf8'));
const existing = read('data/calendar/fohui-dates.json'), catalog = read('data/calendar/catalog.json');
const ledger = read('data/calendar/published-record-ids.json');
const esc = value => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const page = days => `<table>${days.map(day => `<td class="cal_dayshasevents today"><a class="cal_daylink"> ${Number(day.date.slice(8))}</a>` +
  `<a class="eventfull ev" title="${esc('藏历：' + day.tibetan)}" data-content="${esc(day.labels.join('<br>'))}">x</a></td>`).join('')}</table>`;
const month = (year, m) => existing.days.filter(day => day.date.startsWith(`${year}-${String(m).padStart(2, '0')}`)).map(day => structuredClone(day));
const parse = (days, year, m) => parseMonthPage(page(days), year, m);

test('re-reading unchanged month pages reports no change and keeps the data identical', () => {
  const {days, snapshot} = parse(month(2027, 4), 2027, 4);
  assert.equal(snapshot.days, 30);
  assertCompleteMonth(days, 2027, 4);
  assert.deepEqual(diffSource({existing, incoming: days, catalog, ledger}), []);
  const merged = mergeSource({existing, incoming: days, snapshots: [], ledger, changes: [], retrievedOn: existing.retrievedOn});
  assert.deepEqual(merged.source.days, existing.days);
  assert.deepEqual(merged.ledger, ledger);
});

test('a corrected published date is recorded as a move and keeps its stable record ID', () => {
  const record = ledger.records.find(r => r.sourceLabel === '春分' && r.date === '2027-03-21');
  const days = month(2027, 3);
  days.find(d => d.date === '2027-03-21').labels = days.find(d => d.date === '2027-03-21').labels.filter(l => l !== '春分');
  days.find(d => d.date === '2027-03-20').labels.push('春分');
  const incoming = parse(days, 2027, 3).days;
  const changes = diffSource({existing, incoming, catalog, ledger});
  assert.deepEqual(changes.map(c => [c.kind, c.from, c.to, c.recordId]), [['moved', '2027-03-21', '2027-03-20', record.recordId]]);
  const merged = mergeSource({existing, incoming, snapshots: [], ledger, changes, retrievedOn: '2026-11-08'});
  assert.equal(merged.ledger.records.find(r => r.recordId === record.recordId).date, '2027-03-20');
  assert.equal(merged.ledger.records.length, ledger.records.length);
});

test('a newly published month extends coverage and registers new occurrences with fresh IDs', () => {
  const days = month(2027, 5);
  for (let d = days.length + 1; d <= 31; d++) {
    const date = `2027-05-${String(d).padStart(2, '0')}`;
    days.push({date, tibetan: getTibetanDate(date).display, labels: [], source: ''});
  }
  days.find(d => d.date === '2027-05-14').labels.push('金刚萨埵法会开始');
  const {days: incoming, snapshot} = parse(days, 2027, 5);
  assertCompleteMonth(incoming, 2027, 5);
  const changes = diffSource({existing, incoming, catalog, ledger});
  assert.deepEqual(changes.map(c => [c.kind, c.date, c.eventId]), [['added', '2027-05-14', 'vajrasattva-assembly-start']]);
  const merged = mergeSource({existing, incoming, snapshots: [snapshot], ledger, changes, retrievedOn: '2026-11-08'});
  assert.equal(merged.source.end, '2027-05-31');
  const ids = ledger.records.map(r => Number(r.recordId.slice(6)));
  assert.equal(changes[0].recordId, `fohui-${String(Math.max(...ids) + 1).padStart(5, '0')}`);
  assert.ok(merged.ledger.records.some(r => r.recordId === changes[0].recordId && r.date === '2027-05-14'));
});

test('unknown names, calendar disagreements, shrinking coverage and withdrawals stop the merge', () => {
  const days = month(2027, 3);
  days[2].labels.push('未收录的新名称');
  days[3].tibetan = '三月初一';
  const removedRecord = ledger.records.find(r => r.date.startsWith('2027-03'));
  const target = days.find(d => d.date === removedRecord.date);
  target.labels = target.labels.filter(label => label !== removedRecord.sourceLabel);
  const incoming = parse(days, 2027, 3).days.slice(0, 28);
  const changes = diffSource({existing, incoming, catalog, ledger});
  for (const kind of ['unmapped-label', 'pro-mismatch', 'tibetan-date', 'coverage-shrink', 'removed']) {
    assert.ok(changes.some(c => c.kind === kind && c.blocking), kind);
  }
  assert.throws(() => mergeSource({existing, incoming, snapshots: [], ledger, changes, retrievedOn: '2026-11-08'}), /人工核对/);
  assert.throws(() => assertCompleteMonth(incoming, 2027, 3), /28\/31/);
  assert.doesNotThrow(() => assertCompleteMonth(incoming, 2027, 3, {allowTrailing: true}));
});

test('an explicitly confirmed withdrawal keeps its ID reserved', () => {
  const record = ledger.records.find(r => r.date.startsWith('2027-03'));
  const days = month(2027, 3);
  const target = days.find(d => d.date === record.date);
  target.labels = target.labels.filter(label => label !== record.sourceLabel);
  const incoming = parse(days, 2027, 3).days;
  const changes = diffSource({existing, incoming, catalog, ledger});
  const merged = mergeSource({existing, incoming, snapshots: [], ledger, changes, retrievedOn: '2026-11-08', acceptRemovals: true});
  assert.ok(!merged.ledger.records.some(r => r.recordId === record.recordId));
  assert.equal(merged.ledger.withdrawn[0].recordId, record.recordId);
});
