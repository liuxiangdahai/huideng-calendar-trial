import fs from 'node:fs/promises';
import path from 'node:path';
import {digest, SourceFailure} from './fohui-fetch.mjs';
import {diffSource, mergeSource} from './fohui-source.mjs';
import {generateOccurrences} from '../../static/calendar-reminders/engine.mjs';

export const INPUTS = ['data/calendar/fohui-dates.json', 'data/calendar/published-record-ids.json', 'data/calendar/catalog.json', 'data/calendar/fohui-changes.json'];
export const OUTPUTS = INPUTS.filter(file => !file.endsWith('catalog.json'));
const json = value => JSON.stringify(value, null, 2) + '\n';
const defaultLog = () => ({schemaVersion: 1, note: '佛慧法语原历变更记录。名称与安排以佛慧法语为准；此文件只记录，不覆盖来源。', entries: []});
const dayAfter = date => new Date(Date.parse(date) + 86400000).toISOString().slice(0, 10);
export const factsDigest = days => digest(JSON.stringify(days.map(({date, tibetan, labels}) => ({date, tibetan, labels: [...labels].sort()})).sort((a,b) => a.date.localeCompare(b.date))));

export async function readSourceState(root = '.') {
  const raw = {}, baseDigests = {};
  for (const file of INPUTS) {
    try { raw[file] = await fs.readFile(path.join(root, file), 'utf8'); }
    catch (error) { if (error.code !== 'ENOENT' || !file.endsWith('fohui-changes.json')) throw error; raw[file] = null; }
    baseDigests[file] = raw[file] === null ? null : digest(raw[file]);
  }
  return {existing: JSON.parse(raw[INPUTS[0]]), ledger: JSON.parse(raw[INPUTS[1]]), catalog: JSON.parse(raw[INPUTS[2]]), log: raw[INPUTS[3]] ? JSON.parse(raw[INPUTS[3]]) : defaultLog(), baseDigests};
}

// Recheck the current year, the preceding 90 days, and next year's publication.
// Historical source days outside this window are retained, never truncated.
export function plannedMonths(existing, now = new Date()) {
  const date = now.toISOString().slice(0,10), year = now.getUTCFullYear();
  const lookback = new Date(Date.parse(date) - 90 * 86400000).toISOString().slice(0,7);
  const start = [existing.start.slice(0,7), [lookback, `${year}-01`, existing.end.slice(0,7)].sort()[0]].sort().at(-1);
  const end = [`${year + 1}-12`, existing.end.slice(0,7)].sort().at(-1);
  const result = [];
  for (let cursor = start; cursor <= end;) {
    const [y,m] = cursor.split('-').map(Number); result.push([y,m]);
    cursor = new Date(Date.UTC(y,m,1)).toISOString().slice(0,7);
    if (result.length > 36) throw new SourceFailure('range-too-large', '来源检查范围超过36个月，需检查资料边界。');
  }
  return result;
}

export async function collectMonths(client, existing, now = new Date(), onMonth = () => {}) {
  const months = plannedMonths(existing, now), policy = await client.checkPolicy(...months[0]);
  const incoming = [], snapshots = [], observations = [];
  let previousDay = null, publicationEnded = false;
  for (const [year,month] of months) {
    const key = `${year}-${String(month).padStart(2,'0')}`;
    const known = existing.days.some(d => d.date.startsWith(key));
    const result = await client.month(year,month,{allowTrailing:true,allowUnpublished:!known});
    const count = result.days.length, expected = new Date(Date.UTC(year,month,0)).getUTCDate();
    observations.push({month:key,days:count,state:result.unpublished?'unpublished':count<expected?'partial':'complete',sha256:result.snapshot.sha256,cached:!!result.cached});
    onMonth(observations.at(-1));
    if (!count) { publicationEnded = true; continue; }
    if (publicationEnded || (previousDay && dayAfter(previousDay) !== result.days[0].date)) throw new SourceFailure('publication-gap','月份之间的已发布资料不连续，不能把缺页视为未发布。',{month:key});
    incoming.push(...result.days); snapshots.push(result.snapshot); previousDay = result.days.at(-1).date;
    if (count < expected) publicationEnded = true;
  }
  if (!incoming.length) throw new SourceFailure('empty-publication','未取得任何有效日期，保留现有资料。');
  return {incoming,snapshots,observations,policy,requests:client.requests};
}

// This function never writes. A complete, validated candidate is kept separate
// from production data; the existing build then validates lunar UIDs as well.
export function prepareUpdate(state, collection, {now = new Date(), maxExtensionDays = 400} = {}) {
  const {existing,ledger,catalog,log,baseDigests} = state;
  const {incoming,snapshots,observations=[],policy=null,requests=[]} = collection;
  const changes = diffSource({existing,incoming,catalog,ledger});
  const known = new Map(existing.days.map(d => [d.date,d]));
  const newDays = incoming.filter(d => !known.has(d.date));
  const editedDays = incoming.filter(d => known.has(d.date) && factsDigest([d]) !== factsDigest([known.get(d.date)]));
  const retrievedOn = now.toISOString().slice(0,10);
  const report = {schemaVersion:1,checkedAt:now.toISOString(),status:'unchanged',automaticEligible:false,
    before:{start:existing.start,end:existing.end,days:existing.days.length,factsSha256:factsDigest(existing.days)},
    candidateRange:[incoming[0].date,incoming.at(-1).date],newDays:newDays.length,editedDays:editedDays.length,
    policy:policy ? {...policy,body:undefined} : null,observations,requests,changes};
  if (changes.some(c => c.blocking)) { report.status='review-required'; return {report,candidate:null}; }
  if (!newDays.length && !editedDays.length) return {report,candidate:null};
  const merged = mergeSource({existing,incoming,snapshots,ledger,changes,retrievedOn});
  // A source may publish the date grid before adding festival labels. Extending
  // the confirmed range would suppress computed observances in that range.
  // Flag missing known slots for review; never invent the missing source label.
  if (newDays.length) {
    const expected=generateOccurrences({catalog},{start:newDays[0].date,end:newDays.at(-1).date});
    const labelEvents=new Map(catalog.events.flatMap(e=>(e.sourceLabels||[e.sourceLabel]).map(label=>[label,e.id])));
    for (const event of expected) {
      const found=merged.source.days.some(day=>Math.abs(Date.parse(day.date)-Date.parse(event.date))<=7*86400000&&day.labels.some(label=>labelEvents.get(label)===event.eventId));
      if(!found)changes.push({kind:'unconfirmed-recurring',blocking:true,eventId:event.eventId,date:event.date,label:catalog.events.find(e=>e.id===event.eventId)?.title});
    }
    if(changes.some(c=>c.blocking)){report.status='review-required';return {report,candidate:null};}
  }
  const extension = newDays.length ? {kind:'coverage-extended',blocking:false,from:newDays[0].date,to:newDays.at(-1).date,days:newDays.length} : null;
  if (extension) changes.push(extension);
  report.after = {start:merged.source.start,end:merged.source.end,days:merged.source.days.length,factsSha256:factsDigest(merged.source.days)};
  // Only new, future days after the old confirmed range can auto-publish.
  // Corrections and restorations still become a checked PR for identity review.
  report.automaticEligible = !editedDays.length && newDays.length > 0 && newDays.length <= maxExtensionDays &&
    newDays.every(d => d.date > existing.end && d.date > retrievedOn) &&
    changes.every(c => ['added','observance-added','coverage-extended'].includes(c.kind));
  report.status = report.automaticEligible ? 'ready' : 'review-required';
  const nextLog = {...log,entries:[...log.entries,...changes.map(c => ({recordedFrom:retrievedOn,...c}))]};
  const candidate = {schemaVersion:1,baseDigests,files:{[OUTPUTS[0]]:json(merged.source),[OUTPUTS[1]]:json(merged.ledger),[OUTPUTS[2]]:json(nextLog)}};
  return {report,candidate};
}

export async function applyCandidate(candidate, root = '.') {
  if (candidate?.schemaVersion !== 1 || Object.keys(candidate.files).sort().join() !== [...OUTPUTS].sort().join()) throw new Error('候选文件列表不合法。');
  const originals = {};
  for (const file of INPUTS) {
    let text;
    try { text=await fs.readFile(path.join(root,file),'utf8'); }
    catch (error) { if(error.code!=='ENOENT')throw error; text=null; }
    if ((text===null?null:digest(text)) !== candidate.baseDigests[file]) throw new Error('已确认资料或目录发生变化，请重新比对，不能覆盖新改动。');
    originals[file]=text;
  }
  // Validate all JSON before touching any file. If a write fails, restore just
  // these original files; CI never publishes an unvalidated partial candidate.
  for (const file of OUTPUTS) JSON.parse(candidate.files[file]);
  const touched=[];
  try {
    for (const file of OUTPUTS) { touched.push(file); await fs.writeFile(path.join(root,file),candidate.files[file]); }
  } catch (error) {
    for (const file of touched) {
      if(originals[file]===null)await fs.rm(path.join(root,file),{force:true});
      else await fs.writeFile(path.join(root,file),originals[file]);
    }
    throw error;
  }
}
