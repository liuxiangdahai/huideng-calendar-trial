import {test,expect} from '@playwright/test';
import fs from 'node:fs/promises';
const path='/calendar-reminders/reminder-check.html';
const stored=page=>page.evaluate(()=>JSON.parse(localStorage.getItem('huideng.reminder-probe.v1')));
async function create(page){await page.goto(path);await page.locator('#create').click();await expect(page.locator('#connection')).toContainText('文件内 5 次提醒');}
test('real probe creation saves settings and checks ICS without claiming phone delivery; observations survive reload',async({page})=>{
  await create(page);const initial=await stored(page);
  expect(initial.subscription.settings.reminderProbe).toBeTruthy();expect(initial.phoneSeenAt).toBeNull();
  await expect(page.locator('#sync')).toContainText('尚未确认');await expect(page.locator('.probe-case')).toHaveCount(6);
  await page.locator('#seen').click();await page.locator('[data-result="a"]').selectOption('missing-field');
  await page.locator('#device').fill('iPhone · iOS 27.0.1');await page.reload();
  await expect(page.locator('#device')).toHaveValue('iPhone · iOS 27.0.1');await expect(page.locator('[data-result="a"]')).toHaveValue('missing-field');
  await page.locator('#repeat').click();await expect(page.locator('#round')).toContainText('第 2 轮');
  const after=await stored(page);expect(after.subscription.feedUrl).toBe(initial.subscription.feedUrl);expect(after.history[0].results.a.status).toBe('missing-field');
  await expect(page.locator('#sync')).toContainText('尚未确认');
  await page.locator('#silent').click();await expect(page.locator('#connection')).toContainText('文件内 4 次提醒');
  await page.locator('#remove').click();await expect(page.locator('.probe-case').first()).toContainText('已撤销');
  await page.locator('#stop').click();await expect(page.locator('#saved')).toContainText('已停用');
  await expect(page.locator('#connection')).toContainText('文件内 0 次提醒');
  const download=page.waitForEvent('download');await page.locator('#export').click();const report=await fs.readFile(await (await download).path(),'utf8');
  expect(report).not.toContain(initial.manageToken);expect(report).not.toContain(initial.subscription.feedUrl);expect(report).toContain('用户填写');
});
test('lost creation response retries the same subscription and first reminder time',async({page})=>{
  let lost=true,first;
  await page.route('**/api/subscriptions',async route=>{const response=await route.fetch();if(lost){lost=false;first=await response.json();await route.abort();}else await route.fulfill({response});});
  await page.goto(path);await page.locator('#create').click();await expect(page.locator('#error')).toBeVisible();
  await page.locator('#retry').click();await expect(page.locator('#connection')).toContainText('文件内 5 次提醒');
  const current=await stored(page);expect(current.subscription.id).toBe(first.id);expect(current.subscription.settings.reminderProbe.startAt).toBe(first.settings.reminderProbe.startAt);
});
test('WeChat blocks preparation and points to Safari; the local guide does not invent successful subscription',async({browser})=>{
  const context=await browser.newContext({userAgent:'Mozilla/5.0 (iPhone) MicroMessenger/8.0',baseURL:'http://127.0.0.1:4173'});
  const page=await context.newPage();await page.goto(path);await expect(page.locator('#create')).toBeDisabled();await expect(page.locator('#notice')).toContainText('Safari');await context.close();
});
test('phone and desktop forms remain reachable with no horizontal overflow',async({page})=>{
  await create(page);
  for(const width of [320,390,585,768,1024,1440]){
    await page.setViewportSize({width,height:640});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.locator('#stop').scrollIntoViewIfNeeded();await expect(page.locator('#stop')).toBeInViewport();
    if([390,1440].includes(width)){
      await page.evaluate(()=>scrollTo(0,0));await fs.mkdir('artifacts/reminder-probe-screenshots',{recursive:true});
      await page.screenshot({path:`artifacts/reminder-probe-screenshots/${width}.png`,fullPage:true,mask:[page.locator('#feed'),page.locator('#manage')]});
    }
  }
});
test('management link restores the same test on another browser without claiming notifications',async({page,browser})=>{
  await create(page);const state=await stored(page);
  const context=await browser.newContext({baseURL:'http://127.0.0.1:4173'}),other=await context.newPage();
  await other.goto(`${path}#probe=${state.subscription.id}.${state.manageToken}`);
  await expect(other.locator('#feed')).toHaveValue(state.subscription.feedUrl);
  await expect(other.locator('#sync')).toContainText('尚未确认');expect(new URL(other.url()).hash).toBe('');
  await other.locator('#check').click();await expect(other.locator('#connection')).toContainText('文件内 5 次提醒');await context.close();
});
