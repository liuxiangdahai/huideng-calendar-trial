import {test,expect} from '@playwright/test';
const read=page=>page.evaluate(()=>JSON.parse(localStorage.getItem('huideng.calendar.v2')));
const credentials=page=>page.evaluate(()=>JSON.parse(localStorage.getItem('huideng.calendar.subscription')));
async function open(page){await page.goto('/calendar-reminders/');await expect(page.locator('#app')).toBeVisible();await page.locator('[data-preset="guru"]').click();}
async function zone(page,value){await page.locator('#zone-settings').click();await page.locator('#zone-search').fill(value);await page.locator(`input[name="timezone"][value="${value}"]`).check();await page.locator('#apply-zone').click();}
async function create(page){await page.locator('#subscribe').click();await page.locator('input[name="device"][value="iphone"]').check();await expect(page.locator('#feed-url')).not.toHaveValue('');await page.locator('[data-close="subscription-dialog"]').first().click();}

test('global region search and changing only zone preserve individual reminder settings',async({page})=>{
  await open(page);const original=await read(page);
  expect(original.zone).toBe('Asia/Shanghai');
  const header=await page.locator('#today-gregorian').textContent();
  await page.locator('#zone-settings').click();
  expect(await page.locator('.zone-option').count()).toBeGreaterThan(400);
  await page.locator('#zone-search').fill('加德满都');
  await expect(page.locator('#zone-options')).toContainText('尼泊尔');
  await expect(page.locator('#zone-options')).toContainText('UTC+05:45');
  await page.locator('input[name="timezone"][value="Asia/Kathmandu"]').check();await page.locator('#apply-zone').click();
  expect((await read(page)).events).toEqual(original.events);
  await expect(page.locator('#today-gregorian')).toHaveText(header);
  await page.reload();expect((await read(page)).zone).toBe('Asia/Kathmandu');
  await page.locator('[data-reminder-group="tsok"]').click();
  await expect(page.locator('#reminder-dialog #zone')).toHaveCount(0);
});

// Chromium supports a real in-session timezone override. Other engines use a
// new device context with the exact same browser storage, validating return to
// the site after travel without pretending that CDP exists on those engines.
async function traveler(browser,browserName){
 let context=await browser.newContext({baseURL:'http://127.0.0.1:4173',timezoneId:browserName==='chromium'?'':'Asia/Shanghai'});
 let page=await context.newPage();
 const cdp=browserName==='chromium'?await context.newCDPSession(page):null;
 if(cdp)await cdp.send('Emulation.setTimezoneOverride',{timezoneId:'Asia/Shanghai'});
 return {page,async change(timezoneId){
  if(cdp){await cdp.send('Emulation.setTimezoneOverride',{timezoneId:''});await cdp.send('Emulation.setTimezoneOverride',{timezoneId});return page;}
  const storageState=await context.storageState();await context.close();
  context=await browser.newContext({baseURL:'http://127.0.0.1:4173',timezoneId,storageState});page=await context.newPage();
  await page.goto('/calendar-reminders/');await expect(page.locator('#app')).toBeVisible();return page;
 },async close(){await context.close();}};
}

test('travel requires explicit choice and saving keeps the same anonymous feed',async({browser,browserName})=>{
  const device=await traveler(browser,browserName);let page=device.page;
  await open(page);await create(page);const sub=await credentials(page);
  page=await device.change('Europe/Paris');
  await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  await expect(page.locator('#device-zone-notice')).toBeVisible();
  expect((await read(page)).zone).toBe('Asia/Shanghai');
  await page.locator('#keep-zone').click();await expect(page.locator('#device-zone-notice')).toBeHidden();
  await page.reload();await expect(page.locator('#device-zone-notice')).toBeHidden();
  page=await device.change('Asia/Kathmandu');
  await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  await page.locator('#use-device-zone').click();
  await expect(page.locator('#save-state')).toHaveText('有未保存的修改');
  expect((await credentials(page)).savedSettings.zone).toBe('Asia/Shanghai');
  await page.locator('#subscribe').click();
  await expect.poll(async()=>(await credentials(page)).revision).toBe(sub.revision+1);
  expect((await credentials(page)).feedUrl).toBe(sub.feedUrl);
  expect((await credentials(page)).savedSettings.zone).toBe('Asia/Kathmandu');
  await device.close();
});

test('device today changes on returning across the date line without shifting reminder zone',async({browser,browserName})=>{
  const device=await traveler(browser,browserName),dates=[];let page=device.page;await open(page);
  for(const timezoneId of ['Pacific/Kiritimati','Etc/GMT+12']){
    page=await device.change(timezoneId);
    await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));
    const today=await page.evaluate(()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;});
    dates.push(today);
    await page.locator('[data-cal-action="today"]').click();
    await expect(page.locator('.cal-day[aria-current="date"]')).toHaveAttribute('data-cal-date',today);
    const expected=await page.evaluate(()=>new Intl.DateTimeFormat('zh-CN',{year:'numeric',month:'long',day:'numeric',weekday:'short'}).format(new Date()));
    await expect(page.locator('#today-gregorian')).toHaveText(expected);
  }
  expect(dates[0]).not.toBe(dates[1]);expect((await read(page)).zone).toBe('Asia/Shanghai');
  await device.close();
});

test('unknown saved zone prompts manual choice without falling back or discarding selections',async({page})=>{
  await open(page);await page.evaluate(()=>{const s=JSON.parse(localStorage.getItem('huideng.calendar.v2'));s.zone='Moon/Base';s.events['dakini-tsok'].mode='display';localStorage.setItem('huideng.calendar.v2',JSON.stringify(s));});
  await page.reload();await expect(page.locator('#zone-dialog')).toBeVisible();
  expect((await read(page)).zone).toBe('');expect((await read(page)).events['dakini-tsok'].mode).toBe('display');
  await expect(page.locator('#apply-zone')).toBeDisabled();
  await page.locator('#zone-search').fill('上海');await page.locator('input[name="timezone"][value="Asia/Shanghai"]').check();await page.locator('#apply-zone').click();
  expect((await read(page)).events['dakini-tsok'].mode).toBe('display');
});

test('failed timezone save retains the draft and retry updates the existing feed',async({page})=>{
  await open(page);await create(page);const sub=await credentials(page);await zone(page,'Australia/Eucla');
  await page.route(`**/api/subscriptions/${sub.id}`,route=>route.request().method()==='PATCH'?route.fulfill({status:503,json:{error:'服务暂时不可用，请稍后重试。'}}):route.continue());
  await page.locator('#subscribe').click();await expect(page.locator('#subscription-error')).toContainText('稍后重试');
  expect((await read(page)).zone).toBe('Australia/Eucla');expect((await credentials(page)).revision).toBe(sub.revision);
  await page.unroute(`**/api/subscriptions/${sub.id}`);await page.locator('#save-subscription').click();
  await expect(page.locator('#subscription-error')).toBeHidden();
  await expect.poll(async()=>(await credentials(page)).revision).toBe(sub.revision+1);expect((await credentials(page)).feedUrl).toBe(sub.feedUrl);
});

