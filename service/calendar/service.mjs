import {civilDateInZone} from '../../static/calendar-reminders/timezones.mjs';
import {addDays, resolveAlarmInstants as defaultAlarmInstants} from '../../static/calendar-reminders/core.mjs';

const JSON_HEADERS = {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store'};
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const ID_PATTERN = /^[a-f0-9-]{36}$/;
const MAX_BODY_BYTES = 65536;
const RETENTION_MS = 90 * 86400000;
const SNAPSHOT_TTL_MS = 60 * 60 * 1000;
const CREATION_REPLAY_MS = 7 * 86400000;
const DEVELOPMENT_RELEASE = Object.freeze({version: 'development', dataVersion: '',
  rendererVersion: 'snapshot-v1', environment: 'local'});
const utf8 = new TextEncoder();

class HttpError extends Error {
  constructor(status, message, details) { super(message); this.status = status; this.details = details; }
}
const json = (body, status = 200) => new Response(JSON.stringify(body), {status, headers: JSON_HEADERS});
const canonical = value => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().filter(key => value[key] !== undefined)
      .map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
};
export async function digest(value) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', utf8.encode(value)))]
    .map(byte => byte.toString(16).padStart(2, '0')).join('');
}
function base64url(bytes) {
  return btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}
function token() { return base64url(crypto.getRandomValues(new Uint8Array(32))); }
async function creationCredential(key, salt) {
  if (!salt) throw new HttpError(503, '订阅服务尚未配置。');
  const secret = await crypto.subtle.importKey('raw', utf8.encode(salt),
    {name: 'HMAC', hash: 'SHA-256'}, false, ['sign']);
  return base64url(new Uint8Array(await crypto.subtle.sign('HMAC', secret,
    utf8.encode(`huideng-calendar:create-management:v1:${key}`))));
}
function equalHash(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string' || left.length !== right.length) return false;
  let different = 0;
  for (let i = 0; i < left.length; i++) different |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return different === 0;
}
function serviceOrigin(env) {
  let url;
  try { url = new URL(env.PUBLIC_BASE_URL); } catch { throw new HttpError(503, '订阅服务尚未配置。'); }
  const local = env.ALLOW_LOCAL_DEV === 'true' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !(local && url.protocol === 'http:')) ||
      url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new HttpError(503, '订阅服务地址配置无效。');
  }
  return url.origin;
}
function origins(env) {
  const allowed = new Set();
  for (const value of String(env.ALLOWED_ORIGINS || '').split(',')) {
    try {
      const url = new URL(value.trim());
      const local = env.ALLOW_LOCAL_DEV === 'true' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
      if (url.origin === value.trim() && (url.protocol === 'https:' || (local && url.protocol === 'http:'))) {
        allowed.add(url.origin);
      }
    } catch {}
  }
  return allowed;
}
function checkOrigin(request, env, required = false) {
  const origin = request.headers.get('Origin');
  if (origin === 'null' || (origin && !origins(env).has(origin)) || (required && !origin)) {
    throw new HttpError(403, '请从已启用订阅服务的网站打开。');
  }
  return origin;
}
function secureHeaders(response, origin, secure = false) {
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('Referrer-Policy', 'no-referrer');
  response.headers.set('X-Robots-Tag', 'noindex, nofollow, noarchive');
  if (secure) response.headers.set('Strict-Transport-Security', 'max-age=31536000');
  if (origin) {
    response.headers.set('Access-Control-Allow-Origin', origin);
    response.headers.set('Vary', 'Origin');
    response.headers.set('Access-Control-Allow-Methods', 'GET, HEAD, POST, PATCH, DELETE, OPTIONS');
    response.headers.set('Access-Control-Allow-Headers', 'Authorization, Content-Type, Idempotency-Key');
    response.headers.set('Access-Control-Expose-Headers', 'ETag, Last-Modified');
  }
  return response;
}
async function readBody(request) {
  if (!request.headers.get('Content-Type')?.toLowerCase().startsWith('application/json')) {
    throw new HttpError(415, '请使用 JSON 格式提交设置。');
  }
  if (Number(request.headers.get('Content-Length')) > MAX_BODY_BYTES) throw new HttpError(413, '设置内容过大。');
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(400, '缺少设置内容。');
  let length = 0;
  const chunks = [];
  try {
    while (true) {
      const {done, value} = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_BODY_BYTES) {
        await reader.cancel();
        throw new HttpError(413, '设置内容过大。');
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const body = JSON.parse(new TextDecoder().decode(bytes));
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error();
    return body;
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, '设置内容无法读取。');
  }
}
function recordView(record, baseUrl) {
  return {
    id: record.id, feedUrl: `${baseUrl}/calendar/${record.feed_token}.ics`,
    settings: JSON.parse(record.settings_json), revision: record.revision,
    disabled: Boolean(record.disabled), updatedAt: record.updated_at
  };
}
async function authenticate(request, db, id) {
  const bearer = request.headers.get('Authorization')?.match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1];
  if (!bearer) throw new HttpError(401, '请使用此订阅的管理链接打开。');
  const record = await db.prepare('SELECT * FROM subscriptions WHERE id = ?').bind(id).first();
  const actual = await digest(bearer);
  if (!record || !equalHash(actual, record.manage_token_hash)) throw new HttpError(401, '管理链接无效或已经停用。');
  return record;
}
const bound = (db, sql, values) => db.prepare(sql).bind(...values);
function rollingWindow(time, zone) {
  const today = civilDateInZone(time, zone);
  const current = new Date(`${today}T12:00:00Z`), ending = new Date(current);
  const day = ending.getUTCDate();
  ending.setUTCDate(1); ending.setUTCMonth(ending.getUTCMonth() + 24);
  const last = new Date(Date.UTC(ending.getUTCFullYear(), ending.getUTCMonth() + 1, 0)).getUTCDate();
  ending.setUTCDate(Math.min(day, last));
  return {
    start: new Date(current.getTime() - 90 * 86400000).toISOString().slice(0, 10),
    end: new Date(ending.getTime() - 86400000).toISOString().slice(0, 10)
  };
}
function sqlGuard(record) {
  return [record.id, record.revision, record.render_version];
}
const GUARD = 'EXISTS (SELECT 1 FROM subscriptions WHERE id = ? AND revision = ? AND render_version = ?)';
function publicEvent(event, zone, alarmInstants) {
  // Keep the publication ledger small; never store tokens, UI state, or unused catalog metadata in it.
  return {
    uid: event.uid, id: event.id || event.eventId, eventId: event.eventId || event.id,
    title: event.title, date: event.date, tibetan: event.tibetan,
    source: event.source, sourceLabel: event.sourceLabel,
    preference: event.preference.mode === 'remind'
      ? {mode: 'remind', reminders: event.preference.reminders}
      : {mode: 'display', reminders: []},
    reminderZone: event.preference.mode === 'remind' ? zone : undefined,
    alarmInstants: event.preference.mode === 'remind' ? alarmInstants : []
  };
}
function publishedEvent(entry) {
  return {
    ...JSON.parse(entry.event_json),
    sequence: entry.sequence, createdAt: entry.created_at,
    lastModified: entry.modified_at, dtstamp: entry.modified_at,
    status: entry.cancelled_at ? 'CANCELLED' : 'CONFIRMED'
  };
}

/**
 * The D1 binding is the only mutable dependency. Both production and SQLite tests
 * execute the same parameterized SQL and optimistic publication transactions.
 */
export function createCalendarService({getData, validateSettings, selectOccurrences, exportICS,
  resolveAlarmInstants = defaultAlarmInstants, now = () => new Date(), getRelease = () => DEVELOPMENT_RELEASE}) {
  async function releaseFor(data) {
    const release = getRelease();
    return {...release, dataVersion: release.dataVersion || await digest(canonical(data ?? await getData()))};
  }
  async function health(request, env) {
    // Only allow-listed build metadata is public. Configuration values, database
    // diagnostics, subscription addresses and credentials never enter this body.
    let release = getRelease();
    let ready = true;
    try {
      release = await releaseFor();
      serviceOrigin(env);
      if (!env.DB || !origins(env).size || !env.RATE_LIMIT_SALT ||
          !release.version || !release.dataVersion || !release.rendererVersion || !release.environment) throw new Error();
      await env.DB.prepare(`SELECT s.id, s.render_version, s.creation_key_hash, s.creation_body_hash,
          f.settings_revision, f.expires_at,
          e.uid, e.sequence, l.bucket, l.expires_at
        FROM subscriptions s INDEXED BY subscriptions_creation_key
        LEFT JOIN feed_snapshots f ON f.subscription_id = s.id
        LEFT JOIN calendar_entries e ON e.subscription_id = s.id
        LEFT JOIN creation_limits l ON 0 LIMIT 0`).all();
    } catch { ready = false; }
    const body = {status: ready ? 'ok' : 'unavailable', version: release.version,
      dataVersion: release.dataVersion, environment: release.environment};
    return new Response(request.method === 'HEAD' ? null : JSON.stringify(body),
      {status: ready ? 200 : 503, headers: JSON_HEADERS});
  }
  async function parseSettings(body, data) {
    if (!Object.hasOwn(body, 'settings')) throw new HttpError(400, '缺少日历设置。');
    try { return validateSettings(body.settings, data.catalog); }
    catch (error) { throw new HttpError(400, error.message || '日历设置无效。'); }
  }
  function validateSelection(data, settings, time) {
    // Validate before persisting without building, escaping and folding an ICS
    // document that would be discarded. Publication still uses the same resolver
    // and stores its final UTC instants in the content digest and serializer.
    const ids = new Set();
    try {
      for (const event of selectOccurrences(data, settings, rollingWindow(time, settings.zone))) {
        if (!event.uid || ids.has(event.uid)) throw new Error('日程标识无效或重复。');
        ids.add(event.uid);
        addDays(event.date, 1);
        resolveAlarmInstants(event, settings.zone);
      }
    } catch (error) { throw new HttpError(400, error.message || '提醒时间无效。'); }
  }
  async function creationBucket(request, env, time) {
    // Cloudflare supplies this header; the Node preview explicitly overwrites it.
    const address = request.headers.get('CF-Connecting-IP');
    if (!address) return null;
    if (!env.RATE_LIMIT_SALT) throw new HttpError(503, '订阅服务尚未配置。');
    const day = time.toISOString().slice(0, 10);
    const bucket = await digest(`${env.RATE_LIMIT_SALT}:${day}:${address}`);
    const expires = new Date(time.getTime() + 2 * 86400000).toISOString();
    return {bucket, expires};
  }
  function replayCreation(record, bodyHash, manageToken, manageHash, time, baseUrl, status = 200) {
    // The nonce is a recovery capability. Neither it nor the derived management
    // token is stored. Salt rotation explicitly fails closed for old attempts.
    if (!equalHash(manageHash, record.manage_token_hash)) {
      throw new HttpError(410, '这次创建已无法恢复。请先检查已保存的管理链接；如需新订阅，请明确重新开始。',
        {code: 'creation_unrecoverable'});
    }
    if (!equalHash(bodyHash, record.creation_body_hash)) {
      throw new HttpError(409, '这次创建提交的内容不一致，未新建订阅。请先恢复原提交，或明确重新开始。',
        {code: 'creation_body_mismatch'});
    }
    if (record.disabled) throw new HttpError(410, '这次创建的订阅已停用；如需新订阅，请重新开始。',
      {code: 'creation_disabled'});
    if (time.getTime() >= Date.parse(record.created_at) + CREATION_REPLAY_MS) {
      throw new HttpError(410, '这次创建已超过七天恢复期限。原订阅不会自动停用；请检查管理链接，或明确重新开始。',
        {code: 'creation_expired'});
    }
    // Return current settings/revision after edits, never the original revision.
    return json({...recordView(record, baseUrl), manageToken}, status);
  }
  async function create(request, env, baseUrl) {
    const key = request.headers.get('Idempotency-Key');
    // Canonical base64url for exactly 32 random bytes (including the last pad bits).
    if (key !== null && !/^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/.test(key)) {
      throw new HttpError(400, '创建标识无效，请重新开始创建。', {code: 'creation_key_invalid'});
    }
    const body = await readBody(request), time = now();
    if (!Object.hasOwn(body, 'settings')) throw new HttpError(400, '缺少日历设置。');
    const keyHash = key === null ? null : await digest(`huideng-calendar:create-key:v1:${key}`);
    // Fingerprint the original request, allowing recovery even after catalog
    // retirement. Replays must not depend on today's validation or date rules.
    const bodyHash = key === null ? null : await digest(canonical(body.settings));
    const manageToken = key === null ? token() : await creationCredential(key, env.RATE_LIMIT_SALT);
    const manageHash = await digest(manageToken);
    if (keyHash) {
      const existing = await env.DB.prepare('SELECT * FROM subscriptions WHERE creation_key_hash = ?').bind(keyHash).first();
      if (existing) return replayCreation(existing, bodyHash, manageToken, manageHash, time, baseUrl);
    }
    const data = await getData(), settings = await parseSettings(body, data);
    // Resolve alerts before persisting, including DST gaps in the rolling window.
    validateSelection(data, settings, time);
    const limit = await creationBucket(request, env, time);
    const id = crypto.randomUUID(), feedToken = token();
    const timestamp = time.toISOString();
    // D1 batch is transactional. Check quota, win the unique key, and charge
    // exactly the winning INSERT together; concurrent retries cost no quota.
    const insert = env.DB.prepare(`INSERT INTO subscriptions
      (id, feed_token, manage_token_hash, settings_json, created_at, updated_at, creation_key_hash, creation_body_hash)
      SELECT ?, ?, ?, ?, ?, ?, ?, ?
      WHERE COALESCE((SELECT count FROM creation_limits WHERE bucket = ?), 0) < 20
      ON CONFLICT(creation_key_hash) DO NOTHING`)
      .bind(id, feedToken, manageHash, canonical(settings), timestamp, timestamp, keyHash, bodyHash, limit?.bucket ?? null);
    const statements = [insert];
    if (limit) statements.push(env.DB.prepare(`INSERT INTO creation_limits(bucket, count, expires_at)
      SELECT ?, 1, ? WHERE EXISTS (SELECT 1 FROM subscriptions WHERE id = ?)
      ON CONFLICT(bucket) DO UPDATE SET count = count + 1`).bind(limit.bucket, limit.expires, id));
    const results = await env.DB.batch(statements);
    if (keyHash) {
      const record = await env.DB.prepare('SELECT * FROM subscriptions WHERE creation_key_hash = ?').bind(keyHash).first();
      if (record) return replayCreation(record, bodyHash, manageToken, manageHash, time, baseUrl,
        results[0].meta.changes === 1 ? 201 : 200);
    }
    if (results[0].meta.changes !== 1) throw new HttpError(429, '今天创建的订阅较多，请稍后再试。');
    return json({id, feedUrl: `${baseUrl}/calendar/${feedToken}.ics`, manageToken, settings, revision: 1}, 201);
  }
  async function manage(request, env, baseUrl, id) {
    const record = await authenticate(request, env.DB, id);
    if (request.method === 'GET') return json(recordView(record, baseUrl));
    if (request.method === 'PATCH') {
      if (record.disabled) throw new HttpError(410, '此订阅已停用，请创建新的订阅。');
      const body = await readBody(request);
      if (!Number.isSafeInteger(body.revision) || body.revision < 1) throw new HttpError(400, '缺少有效的设置版本。');
      if (body.revision !== record.revision) throw new HttpError(409, '设置已在其他页面修改，请重新载入。', {revision: record.revision});
      const data = await getData(), settings = await parseSettings(body, data), time = now();
      const settingsJson = canonical(settings);
      if (settingsJson === record.settings_json) return json(recordView(record, baseUrl));
      validateSelection(data, settings, time);
      const results = await env.DB.batch([
        env.DB.prepare(`UPDATE subscriptions SET settings_json = ?, revision = revision + 1,
          updated_at = ? WHERE id = ? AND revision = ? AND disabled = 0`)
          .bind(settingsJson, time.toISOString(), id, body.revision),
        env.DB.prepare(`DELETE FROM feed_snapshots WHERE subscription_id = ? AND EXISTS
          (SELECT 1 FROM subscriptions WHERE id = ? AND revision = ?)`)
          .bind(id, id, record.revision + 1)
      ]);
      if (results[0].meta.changes !== 1) throw new HttpError(409, '设置已在其他页面修改，请重新载入。');
      return json(recordView({...record, settings_json: settingsJson, revision: record.revision + 1,
        updated_at: time.toISOString()}, baseUrl));
    }
    if (request.method === 'DELETE') {
      // Keep the read URL usable so clients can fetch cancellation tombstones.
      // Erase preferences immediately; old published entries expire after 90 days.
      if (!record.disabled) {
        const timestamp = now().toISOString();
        const results = await env.DB.batch([
          env.DB.prepare(`UPDATE subscriptions SET disabled = 1, settings_json = '{}',
            revision = revision + 1, updated_at = ? WHERE id = ? AND revision = ?`)
            .bind(timestamp, id, record.revision),
          env.DB.prepare(`UPDATE calendar_entries SET cancelled_at = ?, modified_at = ?, sequence = sequence + 1
            WHERE subscription_id = ? AND cancelled_at IS NULL AND EXISTS
            (SELECT 1 FROM subscriptions WHERE id = ? AND disabled = 1 AND revision = ?)`)
            .bind(timestamp, timestamp, id, id, record.revision + 1),
          env.DB.prepare(`DELETE FROM feed_snapshots WHERE subscription_id = ? AND EXISTS
            (SELECT 1 FROM subscriptions WHERE id = ? AND disabled = 1 AND revision = ?)`)
            .bind(id, id, record.revision + 1)
        ]);
        if (results[0].meta.changes !== 1) throw new HttpError(409, '设置已变化，请重新载入后停用。');
      }
      return json({id, disabled: true, message: '订阅已停用。请同时在手机日历中取消订阅，以立即移除已有日程和提醒。'});
    }
    throw new HttpError(405, '不支持此操作。');
  }
  async function materialize(env, feedToken, attempt = 0) {
    const record = await env.DB.prepare('SELECT * FROM subscriptions WHERE feed_token = ?').bind(feedToken).first();
    if (!record) throw new HttpError(404, '订阅不存在。');
    const time = now(), timestamp = time.toISOString();
    const stored = JSON.parse(record.settings_json);
    let data;
    const deployedRelease = getRelease();
    // Production build metadata already contains the audited data digest. A hit
    // must not deserialize the entire calendar dataset just to compare it.
    // Development fixtures without a digest still detect in-place data changes.
    const release = deployedRelease.dataVersion ? deployedRelease : await releaseFor(data = await getData());
    const localDay = civilDateInZone(time, record.disabled ? 'UTC' : stored.zone);
    const snapshot = await env.DB.prepare('SELECT * FROM feed_snapshots WHERE subscription_id = ?').bind(record.id).first();
    if (snapshot && snapshot.settings_revision === record.revision && snapshot.data_version === release.dataVersion &&
        snapshot.renderer_version === release.rendererVersion && snapshot.local_day === localDay &&
        Date.parse(snapshot.generated_at) <= time.getTime() &&
        time.getTime() - Date.parse(snapshot.generated_at) < SNAPSHOT_TTL_MS && Date.parse(snapshot.expires_at) > time.getTime()) {
      return {ics: snapshot.ics, etag: snapshot.etag, modified: snapshot.last_modified};
    }
    data ??= await getData();
    // Catalog retirement can remove a previously valid choice. New API input is
    // still strictly validated; an old saved choice must not break its feed.
    const currentIds = new Set(data.catalog.events.map(event => event.id));
    if (stored.events) stored.events = Object.fromEntries(
      Object.entries(stored.events).filter(([id]) => currentIds.has(id)));
    const settings = record.disabled ? {zone: 'UTC'} : validateSettings(stored, data.catalog);
    const selection = record.disabled ? [] : selectOccurrences(data, settings, rollingWindow(time, settings.zone));
    const prior = (await env.DB.prepare('SELECT * FROM calendar_entries WHERE subscription_id = ?')
      .bind(record.id).all()).results;
    const previous = new Map(prior.map(entry => [entry.uid, entry])), next = new Map(), changes = [];
    for (const occurrence of selection) {
      if (!occurrence.uid || next.has(occurrence.uid)) throw new Error('Duplicate or missing occurrence UID');
      const event = publicEvent(occurrence, settings.zone, resolveAlarmInstants(occurrence, settings.zone));
      const content = canonical(event), hash = await digest(content), old = previous.get(event.uid);
      const changed = !old || old.content_hash !== hash || Boolean(old.cancelled_at);
      const entry = !changed ? old : {
        subscription_id: record.id, uid: event.uid, content_hash: hash, event_json: content,
        sequence: old ? old.sequence + 1 : 0, created_at: old?.created_at || timestamp,
        modified_at: timestamp, cancelled_at: null
      };
      next.set(event.uid, entry);
      if (changed) changes.push(entry);
    }
    for (const old of prior) {
      if (next.has(old.uid)) continue;
      const entry = old.cancelled_at ? old : {...old, sequence: old.sequence + 1,
        modified_at: timestamp, cancelled_at: timestamp};
      if (time.getTime() - Date.parse(entry.cancelled_at) < RETENTION_MS) {
        next.set(old.uid, entry);
        if (!old.cancelled_at) changes.push(entry);
      }
    }
    const entries = [...next.values()];
    const events = entries.map(publishedEvent).sort((a, b) =>
      a.date.localeCompare(b.date) || a.uid.localeCompare(b.uid));
    const modified = entries.reduce((latest, entry) => entry.modified_at > latest ? entry.modified_at : latest, record.updated_at);
    const ics = exportICS(events, {zone: settings.zone, name: '慧灯藏历',
      generatedAt: new Date(modified), sourceVersion: data.sourceVersion || data.updatedOn || '',
      usePublishedAlarmInstants: true});
    const etag = `"${await digest(ics)}"`;
    const statements = [];
    if (changes.length) statements.push(bound(env.DB, `INSERT INTO calendar_entries
      (subscription_id, uid, content_hash, event_json, sequence, created_at, modified_at, cancelled_at)
      SELECT json_extract(value, '$.subscription_id'), json_extract(value, '$.uid'),
        json_extract(value, '$.content_hash'), json_extract(value, '$.event_json'),
        json_extract(value, '$.sequence'), json_extract(value, '$.created_at'),
        json_extract(value, '$.modified_at'), json_extract(value, '$.cancelled_at')
      FROM json_each(?) WHERE ${GUARD}
      ON CONFLICT(subscription_id, uid) DO UPDATE SET content_hash = excluded.content_hash,
        event_json = excluded.event_json, sequence = excluded.sequence,
        modified_at = excluded.modified_at, cancelled_at = excluded.cancelled_at`,
    [JSON.stringify(changes), ...sqlGuard(record)]));
    // Preserve UID/sequence after removal; re-selecting the same occurrence must
    // not look like an old, out-of-order revision to a calendar client.
    statements.push(bound(env.DB, `UPDATE calendar_entries SET event_json = '{}', content_hash = ''
      WHERE subscription_id = ? AND cancelled_at IS NOT NULL AND cancelled_at <= ?
        AND (event_json != '{}' OR content_hash != '') AND ${GUARD}`,
    [record.id, new Date(time.getTime() - RETENTION_MS).toISOString(), ...sqlGuard(record)]));
    statements.push(bound(env.DB, `INSERT INTO feed_snapshots
      (subscription_id, settings_revision, data_version, renderer_version, local_day,
        generated_at, expires_at, ics, etag, last_modified)
      SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE ${GUARD}
      ON CONFLICT(subscription_id) DO UPDATE SET settings_revision = excluded.settings_revision,
        data_version = excluded.data_version, renderer_version = excluded.renderer_version,
        local_day = excluded.local_day, generated_at = excluded.generated_at,
        expires_at = excluded.expires_at, ics = excluded.ics, etag = excluded.etag,
        last_modified = excluded.last_modified`,
    [record.id, record.revision, release.dataVersion, release.rendererVersion, localDay,
      timestamp, new Date(time.getTime() + SNAPSHOT_TTL_MS).toISOString(), ics, etag, modified, ...sqlGuard(record)]));
    statements.push(bound(env.DB, `UPDATE subscriptions SET render_version = render_version + 1
      WHERE id = ? AND revision = ? AND render_version = ?`, sqlGuard(record)));
    // D1 batch is transactional. The shared guard prevents stale concurrent feed
    // requests from undoing a settings change or resetting a publication sequence.
    const results = await env.DB.batch(statements);
    if (results.at(-1).meta.changes !== 1) {
      if (attempt >= 2) throw new HttpError(503, '订阅正在更新，请稍后重试。');
      return materialize(env, feedToken, attempt + 1);
    }
    return {ics, etag, modified};
  }
  async function feed(request, env, feedToken) {
    const {ics, etag, modified} = await materialize(env, feedToken);
    const headers = {
      'Content-Type': 'text/calendar; charset=utf-8', 'ETag': etag,
      'Last-Modified': new Date(modified).toUTCString(),
      'Cache-Control': 'private, max-age=300, must-revalidate'
    };
    const matching = request.headers.get('If-None-Match')?.split(',').map(value => value.trim().replace(/^W\//, ''));
    if (matching?.includes(etag) || matching?.includes('*')) return new Response(null, {status: 304, headers});
    return new Response(request.method === 'HEAD' ? null : ics, {headers});
  }
  async function fetch(request, env) {
    let origin;
    const secure = request.url.startsWith('https:');
    const protect = response => secureHeaders(response, origin, secure);
    try {
      const url = new URL(request.url), isAPI = url.pathname.startsWith('/api/');
      const local = env.ALLOW_LOCAL_DEV === 'true' &&
        ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
      if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) {
        // Never forward writes, inspect credentials, or touch D1 over HTTP.
        if (url.protocol !== 'http:' || !['GET', 'HEAD'].includes(request.method)) {
          throw new HttpError(426, '请使用 HTTPS 安全地址重新打开或保存订阅。');
        }
        const target = new URL(serviceOrigin(env));
        if (target.protocol !== 'https:') throw new HttpError(503, '订阅服务地址配置无效。');
        // Assign path and query separately: a path beginning with // must never
        // replace the trusted public host or redirect a capability to a third party.
        target.pathname = url.pathname;
        target.search = url.search;
        return protect(new Response(null, {status: 308, headers: {Location: target.href, 'Cache-Control': 'no-store'}}));
      }
      origin = checkOrigin(request, env, isAPI && ['POST', 'PATCH', 'DELETE', 'OPTIONS'].includes(request.method));
      if (url.pathname === '/healthz' && ['GET', 'HEAD'].includes(request.method)) {
        return protect(await health(request, env));
      }
      const baseUrl = serviceOrigin(env);
      if (!env.DB) throw new HttpError(503, '订阅服务尚未连接资料库。');
      if (request.method === 'OPTIONS') return protect(new Response(null, {status: 204}));
      let response;
      if (url.pathname === '/api/subscriptions' && request.method === 'POST') {
        response = await create(request, env, baseUrl);
      } else {
        const management = url.pathname.match(/^\/api\/subscriptions\/([^/]+)$/);
        const subscription = url.pathname.match(/^\/calendar\/([^/]+)\.ics$/);
        if (management && ID_PATTERN.test(management[1])) {
          response = await manage(request, env, baseUrl, management[1]);
        } else if (subscription && TOKEN_PATTERN.test(subscription[1]) && ['GET', 'HEAD'].includes(request.method)) {
          response = await feed(request, env, subscription[1]);
        } else throw new HttpError(404, '没有找到此页面。');
      }
      return protect(response);
    } catch (error) {
      // Do not log request URLs, authorization headers, settings, or raw SQL errors.
      const status = error instanceof HttpError ? error.status : 503;
      const message = error instanceof HttpError ? error.message : '订阅服务暂时不可用，请稍后再试。';
      return protect(json({error: message, ...(error.details || {})}, status));
    }
  }
  async function scheduled(_controller, env) {
    const time = now();
    // Purge only expired tombstones and anonymous abuse counters. Active event
    // rows must remain so a temporary deselection never resets its stable UID.
    await env.DB.batch([
      env.DB.prepare(`UPDATE calendar_entries SET event_json = '{}', content_hash = ''
        WHERE cancelled_at IS NOT NULL AND cancelled_at <= ? AND (event_json != '{}' OR content_hash != '')`)
        .bind(new Date(time.getTime() - RETENTION_MS).toISOString()),
      env.DB.prepare(`DELETE FROM calendar_entries WHERE subscription_id IN
        (SELECT id FROM subscriptions WHERE disabled = 1 AND updated_at <= ?)`)
        .bind(new Date(time.getTime() - RETENTION_MS).toISOString()),
      env.DB.prepare('DELETE FROM creation_limits WHERE expires_at < ?').bind(time.toISOString()),
      env.DB.prepare('DELETE FROM feed_snapshots WHERE expires_at <= ?').bind(time.toISOString())
    ]);
  }
  return {fetch, scheduled};
}
