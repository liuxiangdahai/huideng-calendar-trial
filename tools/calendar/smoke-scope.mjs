// Decide how much of the remote acceptance test a release runs.
//
// The acceptance and trial databases share one Cloudflare free account, so
// every row the test writes comes out of the same 100,000-row daily budget the
// dharma brothers' calendars use. The full test (all presets, 30 edits, every
// daily-date mode) writes roughly 12-15k rows. Run it only when a change can
// alter what a feed contains or how the service stores it; otherwise run the
// light test (create, recover, read, edit a few times, cancel, delete).
//
// The comparison base is the version the trial site is serving now, not the
// previous push: if an earlier release failed before reaching trial, its
// changes still count here and still get the full test.
//
// Usage: node tools/calendar/smoke-scope.mjs <trial-site-origin> <after-sha>
// Prints "scope=full" or "scope=light" (GitHub step output format).
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export const FULL_PATTERNS = [
  /^service\//,
  /^static\/calendar-reminders\/(core|presets|timezones)\.mjs$/,
  /^static\/calendar-reminders\/calendar-data\.json$/,
  /^static\/calendar-reminders\/feeds\//,
  /^data\//,
  /^tools\/calendar\/(smoke-remote|smoke-scope|build|build-environment|release-build|import-fohui|fohui-source)\.mjs$/,
  /^package(-lock)?\.json$/
];

export function scopeFor(files) {
  if (!Array.isArray(files)) return 'full';
  return files.some(file => FULL_PATTERNS.some(pattern => pattern.test(file))) ? 'full' : 'light';
}

function changedFiles(before, after) {
  // A new branch, a force push or a manual run has no usable "before": test everything.
  if (!/^[0-9a-f]{40}$/.test(before || '') || /^0+$/.test(before) || !/^[0-9a-f]{40}$/.test(after || '')) return null;
  try { return execFileSync('git', ['diff', '--name-only', before, after], {encoding: 'utf8'}).split('\n').filter(Boolean); }
  catch { return null; }
}

async function liveVersion(origin) {
  try {
    const url = new URL('/healthz', origin);
    if (url.protocol !== 'https:') return null;
    const body = await (await fetch(url, {signal: AbortSignal.timeout(15000)})).json();
    return body.version;
  } catch { return null; }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const files = changedFiles(await liveVersion(process.argv[2]), process.argv[3]);
  const scope = scopeFor(files);
  console.error(`验收测试范围：${scope === 'full' ? '完整' : '精简'}（${files ? `${files.length} 个改动文件` : '无法比较，按完整'}）`);
  console.log(`scope=${scope}`);
}
