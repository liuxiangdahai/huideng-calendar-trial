import {test,expect} from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import ICAL from 'ical.js';

const route = '/calendar-reminders/';
const origin = 'http://127.0.0.1:4173';
async function open(page, suffix = '') {
  await page.goto(route+suffix);
  await expect(page.locator('#app')).toBeVisible();
  const previewError = await page.locator('#preview-error').textContent();
  if (previewError) throw new Error(previewError);
  await expect(page.locator('.cal-day')).toHaveCount(42);
}
const credentials = page => page.evaluate(() => JSON.parse(localStorage.getItem('huideng.calendar.subscription')));
const draft = page => page.evaluate(() => JSON.parse(localStorage.getItem('huideng.calendar.v2')));
const components = text => new ICAL.Component(ICAL.parse(text)).getAllSubcomponents('vevent');
async function createSubscription(page) {
  await page.locator('[data-preset="tsok"]').click();
  const response = page.waitForResponse(response => response.url().endsWith('/api/subscriptions') && response.request().method() === 'POST');
  await page.locator('#subscribe').click();
  await page.locator('input[name="device"][value="iphone"]').check();
  expect((await response).status()).toBe(201);
  await expect(page.locator('#feed-url')).toHaveValue(/^http:\/\/127\.0\.0\.1:4173\/calendar\/.+\.ics$/);
  await expect(page.locator('#subscription-status')).toContainText('等待日历同步');
  return credentials(page);
}
async function closeSubscription(page) { await page.locator('[data-close="subscription-dialog"]').first().click(); }
async function applyReminder(page, mode, two = false) {
  await page.locator(`input[name="reminder-mode"][value="${mode}"]`).check();
  if (two) await page.locator('#add-reminder').click();
  await page.locator('#reminder-form button[type="submit"]').click();
}
async function downloadText(page, selector) {
  const pending = page.waitForEvent('download');
  await page.locator(selector).click();
  return fs.readFile(await (await pending).path(),'utf8');
}

test('new visitors begin empty, all categories retain exact source names, and choices persist',async({page}) => {
  const errors = []; page.on('pageerror',error => errors.push(error.message));
  await open(page);
  await expect(page.locator('h1')).toHaveText('藏历');
  await expect(page.locator('.group-card')).toHaveCount(7);
  await expect(page.locator('[data-event]:checked')).toHaveCount(0);
  await expect(page.locator('#selection-count')).toHaveText('已选 0 项');
  for (const id of ['subscribe','clear-selection','reminder-settings']) await expect(page.locator(`#${id}`)).toBeDisabled();
  await expect(page.locator('[data-preset][aria-pressed="true"]')).toHaveCount(0);
  await expect(page.locator('#start-date,#months,.hero,#source-update,#search,#search-result,#reset')).toHaveCount(0);
  await page.locator('[data-group-id="masters"] summary').click();
  await expect(page.locator('label:has([data-event="jigme-lingpa"]) .event-title')).toHaveText('持明无畏洲（吉美林巴）尊者圆寂纪念日');
  await page.locator('[data-event="jigme-lingpa"]').check();
  await expect(page.locator('#selection-count')).toHaveText('已选 1 项');
  await expect(page.locator('.group-card')).toHaveCount(7);
  await page.reload();
  expect((await draft(page)).events['jigme-lingpa'].mode).toBe('display');
  expect(errors).toEqual([]);
});

test('category and individual reminder settings export real all-day events and persist',async({page}) => {
  await open(page);
  await page.locator('[data-preset="tsok"]').click();
  await page.locator('#zone-settings').click();
  await page.locator('#zone-search').fill('Vancouver');
  await page.locator('input[name="timezone"][value="America/Vancouver"]').check();
  await page.locator('#apply-zone').click();
  await page.locator('[data-reminder-group="tsok"]').click();
  await applyReminder(page,'remind',true);
  await page.locator('[data-reminder-event="dakini-tsok"]').click();
  await applyReminder(page,'display');
  await expect(page.locator('[data-reminder-event="guru-tsok"]')).toContainText('两次提醒');
  await expect(page.locator('[data-reminder-event="dakini-tsok"]')).toContainText('仅显示');
  await page.locator('#subscribe').click();
  await page.locator('.download-fallback summary').click();
  const alerts = components(await downloadText(page,'[data-download="remind"]'));
  expect(alerts.length).toBeGreaterThan(20);
  for (const event of alerts) {
    expect(event.getFirstPropertyValue('dtstart').isDate).toBe(true);
    expect(event.getFirstPropertyValue('summary')).toBe('莲师荟供日');
    expect(event.getAllSubcomponents('valarm')).toHaveLength(2);
  }
  const quiet = await downloadText(page,'[data-download="display"]');
  expect(quiet).not.toContain('BEGIN:VALARM');
  await page.locator('input[name="device"][value="google"]').check();
  await expect(page.locator('#device-guide')).toContainText('电脑浏览器');
  await expect(page.locator('#device-guide')).toContainText('提醒时间可能不会生效');
  await page.locator('input[name="device"][value="other"]').check();
  await expect(page.locator('#device-guide')).toContainText('文件导入');
  await closeSubscription(page); await page.reload();
  await expect(page.locator('#zone-summary')).toContainText('温哥华');
  expect((await draft(page)).events['guru-tsok'].reminders).toHaveLength(2);
  expect((await draft(page)).events['dakini-tsok'].mode).toBe('display');
});

test('real subscription keeps its URL, cancels removed events and allows saving an empty selection',async({page,request}) => {
  await open(page); const first = await createSubscription(page);
  const firstFeed = components(await (await request.get(first.feedUrl)).text());
  expect(firstFeed.length).toBeGreaterThan(40);
  expect(firstFeed.every(event => event.getFirstPropertyValue('status') === 'CONFIRMED')).toBe(true);
  expect((await request.get(first.feedUrl)).headers().etag).toBeTruthy();
  await closeSubscription(page);
  await page.locator('[data-event="dakini-tsok"]').uncheck();
  await expect(page.locator('#subscribe')).toContainText('保存修改');
  await page.locator('#subscribe').click();
  await expect(page.locator('#subscription-status')).toContainText('设置已保存');
  await expect.poll(async() => (await credentials(page)).revision).toBe(2);
  expect((await credentials(page)).feedUrl).toBe(first.feedUrl);
  const updated = components(await (await request.get(first.feedUrl)).text());
  expect(updated.filter(event => event.getFirstPropertyValue('summary') === '空行母荟供日').every(event => event.getFirstPropertyValue('status') === 'CANCELLED')).toBe(true);
  await closeSubscription(page); await page.locator('[data-clear-group="tsok"]').click();
  await expect(page.locator('#selection-count')).toHaveText('已选 0 项');
  await expect(page.locator('#subscribe')).toBeEnabled();
  await page.locator('#subscribe').click();
  await expect.poll(async() => (await credentials(page)).revision).toBe(3);
  const empty = components(await (await request.get(first.feedUrl)).text());
  expect(empty.every(event => event.getFirstPropertyValue('status') === 'CANCELLED')).toBe(true);
  await page.locator('.management summary').click();
  await page.locator('#stop-subscription').click();
  await page.locator('#confirm-stop').click();
  await expect.poll(() => credentials(page)).toBeNull();
  await expect(page.locator('#save-state')).toContainText('已停用');
});

test('concurrent edits return a conflict and reload explicitly instead of overwriting',async({page,request}) => {
  await open(page); const sub = await createSubscription(page); await closeSubscription(page);
  const remote = structuredClone(sub.savedSettings); remote.zone = 'America/Vancouver';
  const update = await request.patch(`${origin}/api/subscriptions/${sub.id}`,{headers:{Authorization:`Bearer ${sub.manageToken}`,Origin:origin},data:{settings:remote,revision:sub.revision}});
  expect(update.ok()).toBe(true);
  await page.locator('[data-event="dakini-tsok"]').uncheck();
  await page.locator('#subscribe').click();
  await expect(page.locator('#subscription-error')).toContainText('其他设备修改');
  await expect(page.locator('#reload-subscription')).toBeVisible();
  expect((await credentials(page)).revision).toBe(1);
  await page.locator('#reload-subscription').click();
  await expect(page.locator('#subscription-error')).toBeHidden();
  await expect(page.locator('#zone-summary')).toContainText('温哥华');
  expect((await draft(page)).events['dakini-tsok'].mode).toBe('remind');
  expect((await credentials(page)).revision).toBe(2);
});

test('management fragment restores a subscription on another device without leaking its capability',async({page,browser,request}) => {
  await open(page); const sub = await createSubscription(page);
  const other = await browser.newContext({baseURL:origin,timezoneId:'Asia/Shanghai'});
  try {
    const second = await other.newPage(); const requested = [];
    second.on('request',request => requested.push(request.url()));
    await open(second,`#manage=${sub.id}.${sub.manageToken}`);
    await expect(second.locator('#feed-url')).toHaveValue(sub.feedUrl);
    await expect(second).toHaveURL(origin+route);
    await expect.poll(async() => (await credentials(second))?.manageToken).toBe(sub.manageToken);
    expect(requested.some(url => url.includes(sub.manageToken))).toBe(false);
    const feed = await (await request.get(sub.feedUrl)).text();
    expect(feed).not.toContain(sub.manageToken);
    await expect(second.locator('#subscription-status')).toContainText('等待日历同步');
  } finally { await other.close(); }
});

test('invalid management link preserves an existing valid subscription and its draft',async({page}) => {
  await open(page); const sub = await createSubscription(page); await closeSubscription(page);
  await page.locator('[data-event="dakini-tsok"]').uncheck();
  await page.goto(`${route}#manage=${sub.id}.invalid-token`);
  await expect(page.locator('#subscription-error')).toBeVisible();
  expect((await credentials(page)).manageToken).toBe(sub.manageToken);
  expect((await draft(page)).events['dakini-tsok'].mode).toBe('off');
  await expect(page.locator('#feed-url')).toHaveValue(sub.feedUrl);
  await expect(page).toHaveURL(origin+route);
});

test('remote disable clears stale credentials while retaining unsaved local choices',async({page,request}) => {
  await open(page); const sub = await createSubscription(page); await closeSubscription(page);
  await page.locator('[data-event="dakini-tsok"]').uncheck();
  expect((await request.delete(`${origin}/api/subscriptions/${sub.id}`,{headers:{Authorization:`Bearer ${sub.manageToken}`,Origin:origin}})).ok()).toBe(true);
  await page.reload();
  await expect.poll(() => credentials(page)).toBeNull();
  await expect(page.locator('#save-state')).toContainText('已停用');
  expect((await draft(page)).events['dakini-tsok'].mode).toBe('off');
  await page.locator('#my-subscription').click();
  await expect(page.locator('#create-subscription')).toBeVisible();
  await expect(page.locator('#subscription-existing')).toBeHidden();
});

test('edits made during delayed creation and saving remain an unsaved draft',async({page}) => {
  await open(page);
  await page.locator('[data-preset="tsok"]').click();
  let release, received = false;
  const delayed = async route => {
    const response = await route.fetch();
    received = true;
    await new Promise(resolve => { release = resolve; });
    await route.fulfill({response});
  };
  await page.route('**/api/subscriptions',delayed);
  await page.locator('#subscribe').click();
  await page.locator('input[name="device"][value="iphone"]').check();
  await expect.poll(() => received).toBe(true);
  await closeSubscription(page);
  await page.locator('[data-event="dakini-tsok"]').uncheck();
  release();
  await expect.poll(async() => (await credentials(page))?.revision).toBe(1);
  await expect(page.locator('#save-state')).toHaveText('有未保存的修改');
  expect((await draft(page)).events['dakini-tsok'].mode).toBe('off');
  expect((await credentials(page)).savedSettings.events['dakini-tsok'].mode).toBe('remind');
  await page.unroute('**/api/subscriptions',delayed);
  const sub = await credentials(page); received = false;
  await page.route(`**/api/subscriptions/${sub.id}`,delayed);
  await page.locator('#subscribe').click();
  await expect.poll(() => received).toBe(true);
  await closeSubscription(page);
  await page.locator('[data-event="guru-tsok"]').uncheck();
  release();
  await expect.poll(async() => (await credentials(page))?.revision).toBe(2);
  await expect(page.locator('#selection-count')).toHaveText('已选 0 项');
  await expect(page.locator('#save-state')).toHaveText('有未保存的修改');
  expect((await credentials(page)).savedSettings.events['guru-tsok'].mode).toBe('remind');
});

test('mobile selection, preview, long names and dialogs fit 390 and 320 pixel widths',async({page}) => {
  await page.setViewportSize({width:390,height:844}); await open(page);
  await expect(page.locator('#selection-pane')).toBeVisible();
  await expect(page.locator('#preview-pane')).toBeHidden();
  await page.screenshot({path:'.calendar-preview/mobile.png',fullPage:true});
  await page.locator('#tab-preview').click();
  await expect(page.locator('#preview-pane')).toBeVisible();
  await expect(page.locator('#selection-pane')).toBeHidden();
  await page.screenshot({path:'.calendar-preview/mobile-preview.png',fullPage:true});
  await page.locator('#tab-preview').press('ArrowLeft');
  await expect(page.locator('#tab-selection')).toBeFocused();
  await page.locator('[data-group-id="masters"] summary').click();
  await page.locator('[data-event="jigme-lingpa"]').check();
  for (const width of [390,320]) {
    await page.setViewportSize({width,height:844});
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.locator('[data-reminder-event="jigme-lingpa"]').click();
    await page.locator('input[name="reminder-mode"][value="remind"]').check();
    await page.locator('#add-reminder').click();
    expect(await page.locator('#reminder-dialog').evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
    await page.locator('[data-close="reminder-dialog"]').first().click();
    await page.locator('#subscribe').click();
    expect(await page.locator('#subscription-dialog').evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
    await closeSubscription(page);
  }
});

test('desktop layout and visible focus remain usable',async({page}) => {
  await page.setViewportSize({width:1440,height:1100}); await open(page);
  await page.screenshot({path:'.calendar-preview/desktop.png',fullPage:true});
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.locator('[data-group-id="masters"] summary').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-group-id="masters"]')).toHaveAttribute('open','');
  await page.locator('.skip').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-preset="guru"]')).toBeFocused();
});

test('legacy choices migrate without selecting newly added events',async({page}) => {
  await page.addInitScript(() => {
    localStorage.setItem('huideng.calendar.v1',JSON.stringify({version:1,zone:'America/Vancouver',groups:{tsok:{mode:'remind',reminders:[{daysBefore:1,time:'20:00'}]},masters:{mode:'display',reminders:[{daysBefore:0,time:'08:00'}]},buddha:{mode:'off',reminders:[{daysBefore:0,time:'08:00'}]}},overrides:{'dakini-tsok':{mode:'display',reminders:[{daysBefore:0,time:'08:00'}]}}}));
  });
  await open(page); const settings = await draft(page);
  expect(settings.version).toBe(2);
  expect(settings.events['guru-tsok'].reminders).toEqual([{daysBefore:1,time:'20:00'}]);
  expect(settings.events['dakini-tsok'].mode).toBe('display');
  expect(settings.events['jigme-lingpa'].mode).toBe('display');
  expect(Object.values(settings.events).filter(pref => pref.mode !== 'off')).toHaveLength(6);
});

test('unconfigured service and source failure do not imply a successful subscription',async({page}) => {
  await page.route('**/config.json',route => route.fulfill({json:{apiBaseUrl:''}}));
  await open(page); await page.locator('[data-preset="guru"]').click(); await page.locator('#subscribe').click();
  await page.locator('input[name="device"][value="iphone"]').check();
  await expect(page.locator('#service-notice')).toHaveCount(0);
  await expect(page.locator('#subscription-error')).toContainText('暂时无法完成订阅');
  await expect(page.locator('#create-subscription')).toBeEnabled();
  await page.locator('#create-subscription').click();
  await expect(page.locator('#subscription-error')).toContainText('暂时无法完成订阅');
  expect(await credentials(page)).toBeNull();
  await expect(page.locator('#subscription-existing')).toBeHidden();
  await page.route('**/calendar-data.json',route => route.fulfill({status:503,body:'offline'}));
  await page.reload();
  await expect(page.locator('#load-error')).toContainText('日期资料暂时无法读取');
  await expect(page.locator('#app')).toBeHidden();
});

test('standalone works offline, exports real ICS and never creates a fake subscription',async({page}) => {
  await page.context().setOffline(true);
  await page.goto(pathToFileURL(path.resolve('dist/藏历日历.html')).href);
  await expect(page.locator('#app')).toBeVisible();
  await expect(page.locator('.group-card')).toHaveCount(7);
  await page.locator('[data-preset="guru"]').click();
  await page.locator('#subscribe').click();
  await expect(page.locator('body')).not.toContainText('本地体验');
  await page.locator('input[name="device"][value="iphone"]').check();
  await expect(page.locator('#create-subscription')).toBeEnabled();
  await page.locator('#create-subscription').click();
  await expect(page.locator('#subscription-error')).toContainText('暂时无法完成订阅');
  expect(await credentials(page)).toBeNull();
  await page.locator('.download-fallback summary').click();
  const text = await downloadText(page,'[data-download="remind"]');
  expect(components(text).length).toBeGreaterThan(20);
  expect(text).toContain('BEGIN:VALARM');
  await expect(page.locator('#subscription-existing')).toBeHidden();
});
