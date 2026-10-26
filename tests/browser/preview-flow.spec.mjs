import {test, expect} from '@playwright/test';

const route = '/calendar-reminders/';
const settingsKey = 'huideng.calendar.v2';
const uiKey = 'huideng.calendar.interface';
const subscriptionKey = 'huideng.calendar.subscription';
const readStored = (page, key) => page.evaluate(key => JSON.parse(localStorage.getItem(key)), key);
const browserToday = page => page.evaluate(() => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
});

async function open(page) {
  await page.setViewportSize({width: 1440, height: 1100});
  await page.goto(route);
  await expect(page.locator('#app')).toBeVisible();
  await expect(page.locator('#preview-error')).toBeHidden();
  await expect(page.locator('.cal-day')).toHaveCount(42);
  await page.locator('[data-preset="guru"]').click();
}

async function availableMonths(page) {
  return page.locator('[data-cal-month] option').evaluateAll(options => options.map(option => option.value));
}

async function createSubscription(page) {
  const response = page.waitForResponse(response => response.url().endsWith('/api/subscriptions') && response.request().method() === 'POST');
  await page.locator('#subscribe').click();
  await page.locator('input[name="device"][value="iphone"]').check();
  expect((await response).status()).toBe(201);
  await expect(page.locator('#subscription-status')).toContainText('设置已保存');
  await page.locator('[data-close="subscription-dialog"]').first().click();
  return readStored(page, subscriptionKey);
}

test('month preview starts on device today and opens the original event reminder from a date', async ({page}) => {
  await open(page);
  const today = await browserToday(page);
  await expect(page.locator('[data-cal-view="month"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-cal-month]')).toHaveValue(today.slice(0, 7));
  await expect(page.locator('.cal-day[aria-current="date"]')).toHaveAttribute('data-cal-date', today);
  await expect(page.locator('.cal-day[tabindex="0"]')).toHaveCount(1);
  await expect(page.locator('.cal-week')).toHaveCount(6);
  await expect(page.locator('.cal-weekdays [role="columnheader"]')).toHaveText(['一', '二', '三', '四', '五', '六', '日']);
  await expect(page.locator('.cal-legend')).toHaveCount(0);
  await expect(page.locator('#preview-zone')).toHaveCount(0);
  await expect(page.locator('#zone-settings')).toBeVisible();

  const marked = page.locator('.cal-day:not(.cal-adjacent):has(.cal-event-count)').first();
  const date = await marked.getAttribute('data-cal-date');
  await marked.click();
  const firstEvent = page.locator('[data-cal-detail] .cal-event').first();
  const originalTitle = await firstEvent.locator('h4').textContent();
  const id = await firstEvent.locator('[data-cal-event]').getAttribute('data-cal-event');
  await firstEvent.locator('[data-cal-event]').click();
  await expect(page.locator('#reminder-dialog')).toBeVisible();
  await expect(page.locator('#reminder-title')).toHaveText(originalTitle);
  await page.locator('input[name="reminder-mode"][value="display"]').check();
  await page.locator('#reminder-form button[type="submit"]').click();
  await expect(page.locator('#reminder-dialog')).toBeHidden();
  await expect(page.locator('.cal-day.cal-selected')).toHaveAttribute('data-cal-date', date);
  await expect(page.locator(`[data-cal-detail] [data-cal-event="${id}"]`)).toContainText('仅显示，不提醒');
  expect((await readStored(page, settingsKey)).events[id].mode).toBe('display');
});

test('preview remembers month, date and list expansion within a visit, and only view preference across reloads', async ({page}) => {
  await open(page);
  const settings = await readStored(page, settingsKey);
  const today = await browserToday(page);
  const months = await availableMonths(page);
  const laterMonth = months[months.indexOf(today.slice(0, 7)) + 2];
  await page.locator('[data-cal-month]').selectOption(laterMonth);
  const date = laterMonth + '-15';
  await page.locator(`[data-cal-date="${date}"]`).click();
  await page.locator('[data-cal-view="list"]').click();
  await page.locator('[data-cal-action="more"]').click();
  await page.locator('[data-cal-action="more"]').click();
  await expect(page.locator('[data-cal-list-date]')).toHaveCount(15);
  await page.locator('[data-cal-view="month"]').click();
  await expect(page.locator('[data-cal-month]')).toHaveValue(laterMonth);
  await expect(page.locator('.cal-day.cal-selected')).toHaveAttribute('data-cal-date', date);
  await page.locator('[data-cal-view="list"]').click();
  await expect(page.locator('[data-cal-list-date]')).toHaveCount(15);
  expect((await readStored(page, uiKey)).view).toBe('list');
  expect(await readStored(page, settingsKey)).toEqual(settings);

  await page.reload();
  await expect(page.locator('#app')).toBeVisible();
  await expect(page.locator('[data-cal-view="list"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-cal-list-date]')).toHaveCount(5);
  await expect(page.locator('[data-cal-month]')).toHaveValue((await browserToday(page)).slice(0, 7));
  await page.locator('[data-cal-view="month"]').click();
  await expect(page.locator('.cal-day.cal-selected')).toHaveAttribute('data-cal-date', await browserToday(page));
  expect(await readStored(page, settingsKey)).toEqual(settings);
});

test('preview, calendar-app choice and guide confirmations never modify a saved subscription', async ({page}) => {
  await open(page);
  const subscription = await createSubscription(page);
  const settings = await readStored(page, settingsKey);
  const patches = [];
  page.on('request', request => {
    if (request.method() === 'PATCH' && request.url().includes('/api/subscriptions/')) patches.push(request.url());
  });
  await page.locator('[data-cal-action="next"]').click();
  await page.locator('.cal-day:not(.cal-adjacent)').nth(10).click();
  await page.locator('[data-cal-view="list"]').click();
  await page.locator('[data-cal-action="more"]').click();
  await page.locator('#my-subscription').click();
  await page.locator('input[name="device"][value="google"]').check();
  await page.locator('#guide-seen').check();
  await page.locator('[data-guide-expand]>summary').click();
  await page.locator('#guide-reminders').check();
  await page.locator('[data-close="subscription-dialog"]').first().click();
  await expect(page.locator('#save-state')).toHaveText('设置已保存，等待日历同步');
  await expect(page.locator('#subscribe')).not.toContainText('保存修改');
  expect(await readStored(page, settingsKey)).toEqual(settings);
  expect((await readStored(page, subscriptionKey)).revision).toBe(subscription.revision);
  expect((await readStored(page, subscriptionKey)).feedUrl).toBe(subscription.feedUrl);
  expect((await readStored(page, uiKey)).app).toBe('google');
  await page.reload();
  await expect(page.locator('#save-state')).toHaveText('设置已保存，等待日历同步');
  await page.locator('#my-subscription').click();
  await expect(page.locator('input[name="device"][value="google"]')).toBeChecked();
  await expect(page.locator('#guide-seen')).toBeChecked();
  await expect(page.locator('#guide-reminders')).toBeChecked();
  expect(patches).toEqual([]);
});

test('no-selection and unconfirmed-date states remain distinct through cross-year keyboard navigation', async ({page}) => {
  await open(page);
  await page.locator('[data-clear-group="tsok"]').click();
  await expect(page.locator('#selection-count')).toHaveText('已选 0 项');
  await expect(page.locator('[data-cal-detail]')).toContainText('还没有选择日程');
  await page.locator('[data-group-id="nature"] summary').click();
  await page.locator('[data-event="total-solar-eclipse"]').check();
  const data = await (await page.request.get(route + 'calendar-data.json')).json();
  const months = await availableMonths(page);
  const future = months.find(month => month + '-01' > data.published.coverage.end);
  expect(future).toBeTruthy();
  await page.locator('[data-cal-month]').selectOption(future);
  await expect(page.locator('[data-cal-detail]')).toContainText('安排尚待确认');
  await expect(page.locator('[data-cal-detail]')).not.toContainText('当天没有已选日程');

  const december = months.find(month => month.endsWith('-12') && months.includes(`${Number(month.slice(0, 4)) + 1}-01`));
  expect(december).toBeTruthy();
  await page.locator('[data-cal-month]').selectOption(december);
  await page.locator(`[data-cal-date="${december}-31"]`).click();
  await page.keyboard.press('ArrowRight');
  const newYear = `${Number(december.slice(0, 4)) + 1}-01-01`;
  await expect(page.locator(':focus')).toHaveAttribute('data-cal-date', newYear);
  await expect(page.locator('[data-cal-month]')).toHaveValue(newYear.slice(0, 7));
  await page.keyboard.press('Enter');
  await expect(page.locator('.cal-day.cal-selected')).toHaveAttribute('data-cal-date', newYear);
  await expect(page.locator('[data-cal-detail] h3')).toContainText(`${newYear.slice(0, 4)}年1月1日`);
  await expect(page.locator('.cal-day')).toHaveCount(42);
});
