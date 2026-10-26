import {mkdirSync, readFileSync} from 'node:fs';
import {dirname} from 'node:path';
import {SQLiteD1} from './sqlite-d1.mjs';
import {createCalendarService} from './service.mjs';
import {validateSettings, selectOccurrences, exportICS} from '../../static/calendar-reminders/core.mjs';

export function createLocalService({databasePath, origin, now} = {}) {
  if (!databasePath || !origin) throw new Error('databasePath and origin are required');
  const url = new URL(origin);
  if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw new Error('Local preview must bind to localhost');
  mkdirSync(dirname(databasePath), {recursive: true});
  const DB = new SQLiteD1(databasePath);
  const service = createCalendarService({
    getData: () => JSON.parse(readFileSync(new URL('../../static/calendar-reminders/calendar-data.json', import.meta.url), 'utf8')),
    validateSettings, selectOccurrences, exportICS, ...(now ? {now} : {})
  });
  const env = {DB, PUBLIC_BASE_URL: url.origin, ALLOWED_ORIGINS: url.origin, ALLOW_LOCAL_DEV: 'true',
    RATE_LIMIT_SALT: 'local-preview-only'};
  return {
    async fetch(request) {
      const headers = new Headers(request.headers);
      // Never trust a caller-supplied forwarding header in local preview.
      headers.set('CF-Connecting-IP', '127.0.0.1');
      return service.fetch(new Request(request, {headers}), env);
    },
    close() { DB.close(); }
  };
}
