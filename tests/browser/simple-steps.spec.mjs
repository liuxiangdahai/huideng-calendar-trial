import {test,expect} from '@playwright/test';
import ICAL from 'ical.js';

const open=async(page,path='/calendar-reminders/')=>{await page.goto(path);await expect(page.locator('#app')).toBeVisible();};

test('phones start in three simple steps; computers show the detailed settings',async({page})=>{
  await page.setViewportSize({width:390,height:844});await open(page);
  await expect(page.locator('#advanced-settings')).not.toHaveAttribute('open','');
  await expect(page.locator('.region-bar')).toBeHidden();
  await expect(page.locator('#time-choices button').first()).toBeDisabled();
  await expect(page.locator('#step-add-device')).not.toBeEmpty();
  await page.locator('#advanced-settings>summary').click();
  await expect(page.locator('.region-bar')).toBeVisible();
  await page.reload();await expect(page.locator('#app')).toBeVisible();
  await expect(page.locator('#advanced-settings')).toHaveAttribute('open','');
  await page.setViewportSize({width:1440,height:960});
  await page.evaluate(()=>localStorage.clear());await page.reload();await expect(page.locator('#app')).toBeVisible();
  await expect(page.locator('#advanced-settings')).toHaveAttribute('open','');
  await expect(page.locator('.region-bar')).toBeVisible();
});

test('one reminder time applies to every reminding day and newly added preset days follow it',async({page})=>{
  await page.setViewportSize({width:390,height:844});await open(page);
  await page.locator('[data-preset="guru"]').click();
  await expect(page.locator('[data-time-choice="0|08:00"]')).toHaveAttribute('aria-pressed','true');
  await page.locator('[data-time-choice="1|20:00"]').click();
  await expect(page.locator('[data-time-choice="1|20:00"]')).toHaveAttribute('aria-pressed','true');
  await page.locator('[data-preset="tsok"]').click();
  const stored=await page.evaluate(()=>JSON.parse(localStorage.getItem('huideng.calendar.v2')));
  for(const id of ['guru-tsok','dakini-tsok'])expect(stored.events[id].reminders).toEqual([{daysBefore:1,time:'20:00'}]);
  await expect(page.locator('[data-time-choice="1|20:00"]')).toHaveAttribute('aria-pressed','true');
});

test('a shared link pre-fills preset, time, everyday dates and title style, then leaves the address clean',async({page})=>{
  await page.setViewportSize({width:1440,height:960});await open(page);
  await page.locator('[data-preset="tsok"]').click();
  await page.locator('[data-time-choice="0|07:00"]').click();
  await page.locator('#include-daily-dates').check();
  await page.locator('input[name="title-marks"][value="symbols"]').check();
  await expect(page.locator('input[name="title-marks"]')).toHaveCount(2);
  await page.locator('#share-settings').click();
  await expect(page.locator('#share-dialog')).toBeVisible();
  await expect(page.locator('#share-qr svg')).toBeVisible();
  await expect(page.locator('#share-summary')).toContainText('两个荟供日');
  await page.context().grantPermissions(['clipboard-read','clipboard-write']).catch(()=>{});
  const shared=await page.evaluate(()=>{const url=new URL(location.href);url.search='?p=tsok&t=0-0700&d=1&m=symbols';return url.href;});
  const other=await page.context().browser().newContext({viewport:{width:390,height:844},baseURL:new URL(page.url()).origin});
  const phone=await other.newPage();await open(phone,shared);
  await expect(phone.locator('[data-preset="tsok"]')).toHaveAttribute('aria-pressed','true');
  await expect(phone.locator('[data-time-choice="0|07:00"]')).toHaveAttribute('aria-pressed','true');
  await expect(phone.locator('#include-daily-dates')).toBeChecked();
  expect(new URL(phone.url()).search).toBe('');
  const stored=await phone.evaluate(()=>JSON.parse(localStorage.getItem('huideng.calendar.v2')));
  expect(stored.titleMarks).toBe('symbols');
  await other.close();
});

test('after subscribing, the page opens on a sync status with the next reminder; the feed carries title marks',async({page,request})=>{
  await page.setViewportSize({width:390,height:844});await open(page);
  await expect(page.locator('#subscribed-card')).toBeHidden();
  await page.locator('[data-preset="tsok"]').click();
  await page.locator('#subscribe').click();
  await page.locator('input[name="device"][value="other"]').check();
  await expect(page.locator('#copy-feed')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#subscribed-card')).toBeVisible();
  await expect(page.locator('#subscribed-next')).toContainText('下一次提醒');
  const feedUrl=await page.evaluate(()=>JSON.parse(localStorage.getItem('huideng.calendar.subscription')).feedUrl);
  const text=await (await request.get(feedUrl)).text();
  const titles=new ICAL.Component(ICAL.parse(text)).getAllSubcomponents('vevent').map(e=>e.getFirstPropertyValue('summary'));
  expect(titles.length).toBeGreaterThan(0);
  // No marks by default.
  expect(titles.every(title=>!/^[◆◇◦]/.test(title))).toBe(true);
  // Choosing symbols is a normal settings change that the feed follows.
  await page.locator('#advanced-settings>summary').click();
  await page.locator('input[name="title-marks"][value="symbols"]').check();
  await expect(page.locator('#subscribed-card')).toBeHidden();
  await page.locator('#subscribe').click();
  await expect(page.locator('#subscribe-label')).toHaveText('我的订阅');
  const after=await (await request.get(feedUrl)).text();
  expect(after).toMatch(/SUMMARY:◆ 莲师荟供日/);
});

test('inside WeChat the page says first how to open it in a browser',async({browser})=>{
  const context=await browser.newContext({viewport:{width:390,height:844},baseURL:'http://127.0.0.1:4173',
    userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 MicroMessenger/8.0.50'});
  const page=await context.newPage();await open(page);
  await expect(page.locator('#wechat-banner')).toBeVisible();
  await expect(page.locator('#wechat-banner-text')).toContainText('在浏览器中打开');
  await context.close();
});
