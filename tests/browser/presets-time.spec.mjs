import {test,expect} from '@playwright/test';
import ICAL from 'ical.js';
const draft=page=>page.evaluate(()=>JSON.parse(localStorage.getItem('huideng.calendar.v2')));
const creds=page=>page.evaluate(()=>JSON.parse(localStorage.getItem('huideng.calendar.subscription')));
async function open(page){await page.goto('/calendar-reminders/');await expect(page.locator('#app')).toBeVisible();}
test('presets replace choices without undo and clearing preserves local timezone and reminder times',async({page})=>{
  await open(page);await expect(page.locator('[data-event]:checked')).toHaveCount(0);await expect(page.locator('[data-preset][aria-pressed="true"]')).toHaveCount(0);
  await page.locator('[data-preset="guru"]').click();await expect(page.locator('[data-preset="guru"]')).toHaveAttribute('aria-pressed','true');
  // A later generic preset rule once replaced the dark selected background,
  // leaving pale text on paper. Check the rendered state, not only aria-pressed.
  const selected=await page.locator('[data-preset="guru"]').evaluate(node=>{
    const s=getComputedStyle(node);return {background:s.backgroundImage,text:getComputedStyle(node.querySelector('strong')).color};
  });
  expect(selected.background).toContain('gradient');
  expect(selected.background).not.toBe(await page.locator('[data-preset="tsok"]').evaluate(node=>getComputedStyle(node).backgroundImage));
  expect(selected.text).not.toBe('rgb(48, 37, 31)');
  await expect(page.locator('#undo-preset,#preset-undo')).toHaveCount(0);
  await expect(page.locator('#search,#reset')).toHaveCount(0);
  await page.locator('[data-reminder-event="guru-tsok"]').click();await page.locator('[data-reminder-field="time"]').fill('06:30');await page.locator('#add-reminder').click();await page.locator('#reminder-form button[type="submit"]').click();
  const old=await draft(page);await page.locator('[data-preset="practice"]').click();await expect(page.locator('[data-event]:checked')).toHaveCount(54);expect((await draft(page)).events['guru-tsok']).toEqual(old.events['guru-tsok']);
  const prefs=Object.values((await draft(page)).events);expect(prefs.filter(pref=>pref.mode==='remind')).toHaveLength(2);expect(prefs.filter(pref=>pref.mode==='display')).toHaveLength(52);
  await expect(page.locator('[data-preset="practice"]')).toContainText('提醒：荟供日，其余仅显示');await expect(page.locator('[data-preset="practice"]')).toHaveAttribute('aria-pressed','true');
  await page.locator('[data-preset="tsok"]').click();await page.reload();await expect(page.locator('[data-event]:checked')).toHaveCount(2);expect((await draft(page)).events['guru-tsok']).toEqual(old.events['guru-tsok']);
  await page.locator('[data-preset="guru"]').click();await expect(page.locator('[data-event]:checked')).toHaveCount(1);expect((await draft(page)).events['dakini-tsok'].mode).toBe('off');
  await page.locator('[data-preset="practice"]').click();const beforeClear=await draft(page);
  // Clear selections in collapsed categories on the narrowest supported screen.
  await page.setViewportSize({width:320,height:640});
  await expect(page.locator('[data-group-id="masters"]')).not.toHaveAttribute('open','');
  const clear=page.locator('#clear-selection');await expect(clear).toBeEnabled();await clear.scrollIntoViewIfNeeded();
  const bounds=await clear.boundingBox();expect(bounds.x).toBeGreaterThanOrEqual(0);expect(bounds.x+bounds.width).toBeLessThanOrEqual(320);expect(bounds.height).toBeGreaterThanOrEqual(44);
  await clear.focus();await clear.press('Enter');await expect(page.locator('#selection-count')).toHaveText('已选 0 项');await expect(clear).toBeDisabled();
  const cleared=await draft(page);expect(cleared.zone).toBe(beforeClear.zone);
  for(const [id,pref] of Object.entries(cleared.events)){expect(pref.mode).toBe('off');expect(pref.reminders).toEqual(beforeClear.events[id].reminders);}
  await expect(page.locator('#undo-preset,#preset-undo')).toHaveCount(0);
  await page.reload();await expect(page.locator('[data-event]:checked')).toHaveCount(0);
  await page.locator('[data-preset="tsok"]').click();await expect(page.locator('[data-event]:checked')).toHaveCount(2);await expect(clear).toBeEnabled();
  expect(Object.values((await draft(page)).events).filter(pref=>pref.mode==='remind')).toHaveLength(2);
});
test('preset saves retain feed URL, remind only on tsok days and clocks remain UI only',async({page,request})=>{
  await open(page);await page.locator('[data-preset="guru"]').click();await page.locator('#subscribe').click();await page.locator('input[name="device"][value="iphone"]').check();await expect(page.locator('#feed-url')).not.toHaveValue('');const original=await creds(page);await page.locator('[data-close="subscription-dialog"]').first().click();
  await expect(page.locator('#time-comparison')).toContainText('设备与提醒时间');await expect(page.locator('#zone-summary')).toContainText('北京时间 · UTC+08:00');
  await page.locator('[data-preset="practice"]').click();await expect(page.locator('#save-state')).toContainText('未保存');expect((await creds(page)).revision).toBe(original.revision);
  await page.locator('#clear-selection').click();await expect(page.locator('#selection-count')).toHaveText('已选 0 项');await expect(page.locator('#save-state')).toContainText('未保存');
  expect((await creds(page)).revision).toBe(original.revision);expect((await creds(page)).feedUrl).toBe(original.feedUrl);
  const remote=await (await request.get(`/api/subscriptions/${original.id}`,{headers:{Authorization:`Bearer ${original.manageToken}`}})).json();
  expect(remote.revision).toBe(original.revision);expect(remote.settings).toEqual(original.savedSettings);
  await page.locator('[data-preset="practice"]').click();await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await expect(page.locator('#undo-preset,#preset-undo')).toHaveCount(0);
  expect((await creds(page)).revision).toBe(original.revision);await page.locator('#subscribe').click();await expect.poll(async()=>(await creds(page)).revision).toBe(original.revision+1);expect((await creds(page)).feedUrl).toBe(original.feedUrl);
  const events=new ICAL.Component(ICAL.parse(await (await request.get(original.feedUrl)).text())).getAllSubcomponents('vevent');
  const tsok=new Set(['莲师荟供日','空行母荟供日']);expect(events.length).toBeGreaterThan(100);
  for(const event of events)expect(event.getAllSubcomponents('valarm').length).toBe(tsok.has(event.getFirstPropertyValue('summary'))?1:0);
});
test('device clock is primary overseas and cross-zone detail follows actual alarm dates',async({browser})=>{
  const context=await browser.newContext({baseURL:'http://127.0.0.1:4173',timezoneId:'Asia/Singapore'});try{
    const page=await context.newPage();await open(page);await page.locator('[data-preset="guru"]').click();expect((await draft(page)).zone).toBe('Asia/Singapore');await expect(page.locator('#time-comparison')).toContainText('新加坡时间');
    await page.locator('#zone-settings').click();await page.locator('#zone-search').fill('America/New_York');await page.locator('input[value="America/New_York"]').check();await page.locator('#apply-zone').click();
    await expect(page.locator('.clock-item')).toHaveCount(2);await expect(page.locator('.clock-item').first()).toContainText('设备时间');await expect(page.locator('.clock-item').last()).toContainText('提醒地区时间');
    const before=await draft(page);await page.locator('[data-cal-view="list"]').click();await expect(page.locator('.cal-device-time').first()).toContainText('新加坡时间');await page.evaluate(()=>window.dispatchEvent(new Event('focus')));expect(await draft(page)).toEqual(before);
  }finally{await context.close();}
});
