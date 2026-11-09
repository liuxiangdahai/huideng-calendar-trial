import {test,expect} from '@playwright/test';
import fs from 'node:fs/promises';
import ICAL from 'ical.js';

const route='/calendar-reminders/';
const draft=page=>page.evaluate(()=>JSON.parse(localStorage.getItem('huideng.calendar.v2')));
const subscription=page=>page.evaluate(()=>JSON.parse(localStorage.getItem('huideng.calendar.subscription')));
const events=text=>new ICAL.Component(ICAL.parse(text)).getAllSubcomponents('vevent');
const daily=event=>String(event.getFirstPropertyValue('uid')).startsWith('daily-date-');
const close=page=>page.locator('[data-close="subscription-dialog"]').first().click();
async function open(page){await page.goto(route);await expect(page.locator('#app')).toBeVisible();await expect(page.locator('#load-error')).toBeHidden();await expect(page.locator('#preview-error')).toBeHidden();}
async function downloadText(page){const pending=page.waitForEvent('download');await page.locator('[data-download="display"]').click();return fs.readFile(await (await pending).path(),'utf8');}

test('daily date layer starts off, preserves legacy choices and presets, and clear removes both layers',async({page})=>{
 await open(page);await expect(page.locator('#include-daily-dates')).not.toBeChecked();await expect(page.locator('[data-event]:checked')).toHaveCount(0);
 await expect(page.locator('#subscribe')).toBeDisabled();
 // Opening examples must not change selection or imply a fourth preset.
 await page.locator('.daily-date-help > summary').click();
 await expect(page.locator('.daily-date-examples')).toContainText('重日2');
 await expect(page.locator('#include-daily-dates')).not.toBeChecked();
 await page.locator('.daily-date-help > summary').click();
 await page.locator('#include-daily-dates').focus();await page.keyboard.press('Space');
 await expect(page.locator('#include-daily-dates')).toBeChecked();
 await page.keyboard.press('Space');await expect(page.locator('#include-daily-dates')).not.toBeChecked();
 // A real saved v2 draft from before the date-layer field existed.
 await page.locator('[data-preset="guru"]').click();
 await page.evaluate(()=>{const key='huideng.calendar.v2',value=JSON.parse(localStorage.getItem(key));delete value.includeDailyDates;value.events['guru-tsok'].reminders=[{daysBefore:1,time:'06:30'},{daysBefore:0,time:'08:00'}];localStorage.setItem(key,JSON.stringify(value));});
 await page.reload();await expect(page.locator('#include-daily-dates')).not.toBeChecked();await expect(page.locator('#event-guru-tsok')).toBeChecked();
 expect((await draft(page)).events['guru-tsok'].reminders).toHaveLength(2);
 await page.locator('#include-daily-dates').check();
 for(const preset of ['tsok','practice','guru']){await page.locator(`[data-preset="${preset}"]`).click();await expect(page.locator('#include-daily-dates')).toBeChecked();expect((await draft(page)).includeDailyDates).toBe(true);}
 await page.locator('[data-preset="practice"]').click();
 await expect(page.locator('#selection-count')).toHaveText('已选 54 项');await expect(page.locator('#reminder-count')).toHaveText('2 项提醒');await expect(page.locator('#daily-date-count')).toBeVisible();
 expect((await draft(page)).events['guru-tsok'].reminders).toHaveLength(2);
 await page.locator('#reminder-settings').click();await expect(page.locator('#reminder-scope-note')).toContainText('54 项');
 await page.locator('input[name="reminder-mode"][value="display"]').check();await page.locator('#reminder-form button[type="submit"]').click();
 expect((await draft(page)).includeDailyDates).toBe(true);expect(Object.values((await draft(page)).events).every(pref=>pref.mode!=='remind')).toBe(true);
 const saved=await draft(page);await page.locator('#clear-selection').click();
 await expect(page.locator('#include-daily-dates')).not.toBeChecked();await expect(page.locator('#subscribe')).toBeDisabled();
 expect((await draft(page)).zone).toBe(saved.zone);expect((await draft(page)).events['guru-tsok'].reminders).toEqual(saved.events['guru-tsok'].reminders);
 await page.locator('#include-daily-dates').check();await expect(page.locator('#subscribe')).toBeEnabled();await expect(page.locator('#reminder-settings')).toBeDisabled();
 await expect(page.locator('#selection-count')).toHaveText('每日藏历');await expect(page.locator('#reminder-count')).toHaveText('仅显示');await expect(page.locator('#daily-date-count')).toBeHidden();
 await page.reload();await expect(page.locator('#include-daily-dates')).toBeChecked();
 await page.setViewportSize({width:320,height:568});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.locator('#clear-selection').click();await expect(page.locator('#clear-selection')).toBeDisabled();
});

test('month marks only festivals while daily details and list show real consecutive days, repeats and skips',async({page})=>{
 // PRO validates date.constructor === Date. Playwright's fake clock returns
 // native Date objects with a different constructor; preserve that contract.
 await page.addInitScript(now=>{const NativeDate=Date;window.Date=class Date extends NativeDate{
  constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}
 };},Date.parse('2026-10-01T04:00:00Z'));
 await page.setViewportSize({width:390,height:844});await open(page);
 await page.locator('#include-daily-dates').check();await page.locator('#tab-preview').click();
 await expect(page.locator('.cal-day')).toHaveCount(42);await expect(page.locator('.cal-event-count')).toHaveCount(0);
 await page.locator('[data-cal-date="2026-10-19"]').click();await expect(page.locator('[data-cal-detail]')).toContainText('重日1');
 await expect(page.locator('[data-cal-detail] [data-cal-daily-date]')).toHaveCount(1);await expect(page.locator('[data-cal-detail]')).not.toContainText('藏历 PRO');await expect(page.locator('footer')).toContainText('藏历 PRO');
 await expect(page.locator('[data-cal-detail] [data-cal-event]')).toHaveCount(0);
 // Phones show the day in a bottom sheet; close it before choosing another date.
 const closeSheet=async()=>{await page.keyboard.press('Escape');await expect(page.locator('[data-cal-sheet]')).toBeHidden();};
 await expect(page.locator('[data-cal-sheet]')).toBeVisible();await closeSheet();
 await page.locator('[data-cal-date="2026-10-20"]').click();await expect(page.locator('[data-cal-detail]')).toContainText('重日2');
 await closeSheet();await page.locator('[data-cal-date="2026-10-28"]').click();await expect(page.locator('[data-cal-detail]')).toContainText('九月十七，已跳过');await closeSheet();
 await page.locator('[data-cal-view="list"]').click();await expect(page.locator('[data-cal-list-date]')).toHaveCount(30);
 let dates=await page.locator('[data-cal-list-date]').evaluateAll(nodes=>nodes.map(node=>node.dataset.calListDate));
 expect(dates[0]).toBe('2026-10-01');expect(dates.at(-1)).toBe('2026-10-30');
 expect(dates.every((date,index)=>date===new Date(Date.UTC(2026,9,index+1)).toISOString().slice(0,10))).toBe(true);
 await expect(page.locator('.cal-list-view [data-cal-daily-date]')).toHaveCount(30);
 await page.locator('[data-cal-action="more"]').click();await expect(page.locator('[data-cal-list-date]')).toHaveCount(60);
 await page.locator('[data-cal-view="month"]').click();await page.locator('[data-cal-view="list"]').click();await expect(page.locator('[data-cal-list-date]')).toHaveCount(60);
 await page.locator('#tab-selection').click();await page.locator('[data-preset="guru"]').click();await page.locator('#tab-preview').click();
 await page.locator('[data-cal-view="month"]').click();
 await expect(page.locator('[data-cal-date="2026-10-21"] .cal-event-count')).toHaveText('1');
 await page.locator('[data-cal-date="2026-10-21"]').click();
 await expect(page.locator('[data-cal-detail] [data-cal-daily-date]')).toHaveCount(1);await expect(page.locator('[data-cal-detail] [data-cal-event]')).toHaveCount(1);
 await closeSheet();await page.locator('#tab-selection').click();await page.locator('#include-daily-dates').uncheck();await page.locator('#tab-preview').click();await page.locator('[data-cal-view="list"]').click();
 await expect(page.locator('[data-cal-list-date]')).toHaveCount(5);await expect(page.locator('.cal-list-view [data-cal-daily-date]')).toHaveCount(0);
});

test('daily-only download and subscription remain alarm-free and failed removal retains the draft',async({page,request})=>{
 await open(page);await page.locator('#include-daily-dates').check();await page.locator('#subscribe').click();await page.locator('input[name="device"][value="other"]').check();
 await expect(page.locator('#feed-url')).not.toHaveValue('');const original=await subscription(page);
 expect(original.savedSettings.includeDailyDates).toBe(true);await expect(page.locator('#guide-reminders')).toHaveCount(0);
 const first=events(await (await request.get(original.feedUrl)).text());
 expect(first.length).toBeGreaterThan(800);expect(first.every(daily)).toBe(true);expect(first.every(event=>event.getFirstPropertyValue('dtstart').isDate&&event.getAllSubcomponents('valarm').length===0)).toBe(true);
 await page.locator('.download-fallback>summary').click();await expect(page.locator('[data-download="remind"]')).toHaveCount(0);
 const downloaded=events(await downloadText(page));expect(downloaded.length).toBeGreaterThan(700);expect(downloaded.every(daily)).toBe(true);
 expect(downloaded.every(event=>event.getAllSubcomponents('valarm').length===0)).toBe(true);expect(new Set(downloaded.map(event=>event.getFirstPropertyValue('dtstart').toString())).size).toBe(downloaded.length);
 await close(page);await page.locator('#include-daily-dates').uncheck();await page.locator('[data-preset="guru"]').click();
 await page.route('**/api/subscriptions/*',async route=>route.request().method()==='PATCH'?route.fulfill({status:503,json:{error:'测试保存失败，请重试。'}}):route.fallback());
 await page.locator('#subscribe').click();await expect(page.locator('#subscription-error')).toBeVisible();
 expect((await draft(page)).includeDailyDates).toBe(false);expect((await subscription(page)).savedSettings.includeDailyDates).toBe(true);
 await page.unroute('**/api/subscriptions/*');await page.locator('#save-subscription').click();
 await expect.poll(async()=>(await subscription(page)).revision).toBe(original.revision+1);expect((await subscription(page)).feedUrl).toBe(original.feedUrl);
 const changed=events(await (await request.get(original.feedUrl)).text());expect(changed.filter(daily).every(event=>event.getFirstPropertyValue('status')==='CANCELLED'&&event.getAllSubcomponents('valarm').length===0)).toBe(true);
 expect(changed.filter(event=>!daily(event)).some(event=>event.getAllSubcomponents('valarm').length===1)).toBe(true);
 await page.locator('.management>summary').click();await page.locator('#stop-subscription').click();await page.locator('#confirm-stop').click();await expect.poll(()=>subscription(page)).toBeNull();
});
