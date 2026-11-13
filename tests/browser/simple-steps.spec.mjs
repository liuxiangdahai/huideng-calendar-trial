import {test,expect} from '@playwright/test';
import ICAL from 'ical.js';

const open=async(page,path='/calendar-reminders/#subscribe')=>{await page.goto(path);await expect(page.locator('#app')).toBeVisible();};

test('phones start in three simple steps; computers show the detailed settings',async({page})=>{
  await page.setViewportSize({width:390,height:844});await open(page);
  await expect(page.locator('#advanced-settings')).not.toHaveAttribute('open','');
  await expect(page.locator('.region-bar')).toBeHidden();
  await expect(page.locator('#time-choices button').first()).toBeDisabled();
  await expect(page.locator('#step-add-device')).not.toBeEmpty();
  await page.locator('#advanced-settings>summary').click();
  // On phones the region lives inside the details, next to what it changes;
  // nothing appears at the top of the page.
  await expect(page.locator('.region-bar')).toBeHidden();
  await expect(page.locator('#zone-settings-inline')).toBeVisible();
  // The row shows the region's name; the closed 更多设置 names it too (11-12).
  const zoneName=(await page.locator('#zone-summary').textContent()).split(' · ')[0];
  await expect(page.locator('#zone-summary-inline')).toHaveText(zoneName);
  await expect(page.locator('#advanced-summary')).toContainText(zoneName);
  await expect(page.locator('#advanced-summary')).toContainText('不加标记');
  // Phones always start folded, even after someone opened the details.
  await page.reload();await expect(page.locator('#app')).toBeVisible();
  await expect(page.locator('#advanced-settings')).not.toHaveAttribute('open','');
  // Computers start folded too (11-11): 更多设置 sits before step 3 and is
  // optional. The region is inside it; the top bar only shows when the zones differ.
  await page.setViewportSize({width:1440,height:960});
  await page.evaluate(()=>localStorage.clear());await page.reload();await expect(page.locator('#app')).toBeVisible();
  await expect(page.locator('#advanced-settings')).not.toHaveAttribute('open','');
  await expect(page.locator('.region-bar')).toBeHidden();
  await page.locator('#advanced-settings>summary').click();
  await expect(page.locator('#zone-settings-inline')).toBeVisible();
  // One action, in the bottom bar (11-12): step 3 shows what the calendar
  // will hold and says where to tap; it has no button of its own.
  await page.locator('[data-preset="tsok"]').click();
  await expect(page.locator('#step-add-button')).toHaveCount(0);
  await expect(page.locator('#step-add-device')).toContainText('加入日历');
  await expect(page.locator('#sub-upcoming')).toBeVisible();
  await page.locator('#subscribe').click();
  await expect(page.locator('#subscription-dialog')).toBeVisible();
  // The dialog's own steps are a progress line, not a second 1-2-3. A browser
  // that already names its calendar app starts at 添加.
  await expect(page.locator('#subscription-dialog .guide-stage-number')).toHaveCount(0);
  const app = await page.locator('input[name="device"]:checked').count();
  await expect(page.locator('#subscription-progress [aria-current]')).toHaveText(app ? '添加' : '选日历应用');
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
  await page.locator('#advanced-settings>summary').click();
  // 日历标记 is one row; its two choices open in place (11-12).
  await expect(page.locator('input[name="title-marks"][value="symbols"]')).toBeHidden();
  await page.locator('#title-marks-row>summary').click();
  await page.locator('input[name="title-marks"][value="symbols"]').check();
  await expect(page.locator('input[name="title-marks"]')).toHaveCount(2);
  await expect(page.locator('#title-marks-value')).toHaveText('加符号区分');
  await expect(page.locator('#advanced-summary em')).toHaveText('加符号区分');
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
  await expect(page.locator('#subscribed-next')).toContainText('下次提醒');
  // After adding, the page stays put and says it simply (11-12): no replay.
  await expect(page.locator('#save-state')).toHaveText('已保存，日历会自己更新');
  await expect(page.locator('#subscribed-title')).toHaveText('我的订阅 · 已保存');
  const feedUrl=await page.evaluate(()=>JSON.parse(localStorage.getItem('huideng.calendar.subscription')).feedUrl);
  const text=await (await request.get(feedUrl)).text();
  const titles=new ICAL.Component(ICAL.parse(text)).getAllSubcomponents('vevent').map(e=>e.getFirstPropertyValue('summary'));
  expect(titles.length).toBeGreaterThan(0);
  // No marks by default.
  expect(titles.every(title=>!/^[◆◇◦]/.test(title))).toBe(true);
  // Choosing symbols is a normal settings change that the feed follows.
  await page.locator('#advanced-settings>summary').click();
  await page.locator('#title-marks-row>summary').click();
  await page.locator('input[name="title-marks"][value="symbols"]').check();
  // The card keeps its place and says what to do; it must not vanish and pop back.
  await expect(page.locator('#subscribed-card')).toBeVisible();
  await expect(page.locator('#subscribed-title')).toHaveText('有改动还没保存');
  await expect(page.locator('#subscribed-when')).toContainText('日历会自己更新');
  // How slow some calendars are, and what to do when nothing rings, is in the window.
  await expect(page.locator('#manage-help')).toContainText('个别要等到第二天');
  await page.locator('#subscribe').click();
  await expect(page.locator('#subscribe-label')).toHaveText('我的订阅');
  const after=await (await request.get(feedUrl)).text();
  expect(after).toMatch(/SUMMARY:◆ 莲师荟供日/);
});

test('inside WeChat the page says first how to open it in a browser',async({browser})=>{
  const context=await browser.newContext({viewport:{width:390,height:844},baseURL:'http://127.0.0.1:4173',
    userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 MicroMessenger/8.0.50'});
  const page=await context.newPage();
  // The 藏历 page reads as anywhere else: no banner, no window.
  await page.goto('/calendar-reminders/');await expect(page.locator('#home-calendar')).toBeVisible();
  await expect(page.locator('#wechat-banner')).toBeHidden();
  await expect(page.locator('#wechat-dialog')).toBeHidden();
  // Wanting to add days opens the way to a browser, and points the address
  // at the choices while it is up, so "在浏览器打开" lands there.
  await page.locator('#home-subscribe').click();
  await expect(page.locator('#wechat-dialog')).toBeVisible();
  await expect(page.locator('#wechat-dialog')).toContainText('在浏览器打开');
  await expect(page).toHaveURL(/#subscribe$/);
  expect(await page.evaluate(()=>document.body.dataset.page)).toBe('home');
  await page.locator('#wechat-dialog [data-close]').last().click();
  await expect(page).not.toHaveURL(/#subscribe$/);
  await page.locator('#my-subscription').click();
  await expect(page.locator('#wechat-dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  // Arriving at the choices (a shared link) says it at once; the banner stays
  // on that page and opens the window again.
  await page.goto('about:blank');await page.goto('/calendar-reminders/#subscribe');
  await expect(page.locator('#wechat-dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#wechat-banner')).toBeVisible();
  await expect(page.locator('#wechat-banner-text')).toHaveText('微信里不能直接加入日历');
  await page.locator('#wechat-banner-help').click();
  await expect(page.locator('#wechat-dialog')).toBeVisible();
  await context.close();
});

for (const viewport of [{width:390,height:844},{width:1366,height:900}]) test(`with a subscription, changing the choice and changing it back never moves the choices at ${viewport.width}px`,async({page})=>{
  {
    // One fresh page per width: no subscription carried over from another run.
    await page.setViewportSize(viewport); await open(page);
    await page.locator('[data-preset="tsok"]').click();
    await page.locator('#subscribe').click();
    await expect(page.locator('#subscription-dialog')).toBeVisible();
    await page.locator('input[name="device"][value="other"]').check();
    await expect(page.locator('#copy-feed')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#subscribed-title')).toHaveText('我的订阅 · 已保存');
    const top=()=>page.locator('#preset-options').evaluate(node=>Math.round(node.getBoundingClientRect().top+scrollY));
    const start=await top();
    for (const [preset,title] of [['practice','有改动还没保存'],['tsok','我的订阅 · 已保存'],['guru','有改动还没保存'],['tsok','我的订阅 · 已保存']]) {
      await page.locator(`[data-preset="${preset}"]`).click();
      await expect(page.locator('#subscribed-title')).toHaveText(title);
      expect(await top(),`${viewport.width}px after ${preset}`).toBe(start);
    }
  }
});

test('the subscribe page starts with the choices; the add window says what will ring (11-13)',async({page})=>{
  await page.setViewportSize({width:390,height:844});await open(page);
  // One thin line of date, no big masthead and no extra notice box.
  const masthead=await page.locator('.editorial-masthead').boundingBox();
  expect(masthead.height).toBeLessThan(80);
  await expect(page.locator('#unsubscribed-hint')).toHaveCount(0);
  const firstChoice=await page.locator('[data-preset]').first().boundingBox();
  expect(firstChoice.y).toBeLessThan(300);
  await page.locator('[data-preset="practice"]').click();
  await page.locator('#subscribe').click();
  const summary=page.locator('#subscription-summary');
  await expect(summary).toContainText('项提醒');
  await expect(summary).not.toContainText('全天显示');
  // The apps are one compact row; the chosen one's coverage is one line.
  await page.locator('input[name="device"][value="other"]').check();
  await expect(page.locator('#device-note')).toHaveText('华为、OPPO、小米等');
  const label=await page.locator('.device-options label').first().boundingBox();
  expect(label.height).toBeLessThan(60);
  // A file does not update, so the import fold says how far the festivals reach.
  await page.locator('.download-fallback>summary').click();
  await expect(page.locator('#download-coverage')).toContainText('目前节日更新到 ');
  await expect(page.locator('#download-coverage')).toContainText('要重新下载导入');
});
