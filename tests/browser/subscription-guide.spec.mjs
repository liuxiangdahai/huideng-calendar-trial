import { test, expect } from '@playwright/test';

async function fixture(page, options = {}) {
  await page.route('**/guide-fixture', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="zh-Hans"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/calendar-reminders/subscription-guide.css"><style>body{margin:12px;font-family:system-ui}.icon{width:20px;height:20px;fill:none;stroke:currentColor;stroke-width:1.5}button,input,select{font:inherit}*{box-sizing:border-box}</style><main><div id="add"></div><div id="notifications"></div></main></html>' }));
  await page.goto('/guide-fixture');
  await page.evaluate(async options => {
    const { createSubscriptionGuide } = await import('/calendar-reminders/subscription-guide.mjs');
    window.guideStates = [];
    window.guideTests = 0;
    window.guide = createSubscriptionGuide(document.querySelector('#add'), {
      notificationRoot: document.querySelector('#notifications'), initialState: options,
      onStateChange: state => window.guideStates.push(state), onTestReminder: () => { window.guideTests += 1; }
    });
  }, options);
}

test('Chinese guide keeps self-confirmation separate from subscription and per calendar app', async ({ page }) => {
  await fixture(page);
  await expect(page.locator('#add')).toContainText('先选择');
  await expect(page.locator('#guide-seen')).toHaveCount(0);
  await page.evaluate(() => window.guide.update({ app: 'iphone', hasReminders: true, hasSubscription: true }));
  await expect(page.locator('#guide-seen')).not.toBeChecked();
  await expect(page.locator('#guide-reminders')).not.toBeChecked();
  await page.locator('[data-guide-expand] > summary').click();
  const mac=await page.evaluate(()=>/Macintosh/i.test(navigator.userAgent));
  await expect(page.locator('.guide-notification-body')).toContainText(mac?'忽略提醒':'日程提醒');
  await expect(page.locator('.guide-notification-body')).toContainText('允许通知');
  await expect(page.locator('.guide-notification-body')).toContainText(mac?'在电脑上操作':'请拿起手机');
  await expect(page.locator('a[href^="https://support.apple.com/"]').first()).toHaveAttribute('href', /\/zh-cn\//);
  await page.locator('#guide-seen').check();
  await page.locator('#guide-reminders').check();
  await page.evaluate(() => window.guide.update({ app: 'google', hasSubscription: false }));
  await expect(page.locator('#guide-seen')).not.toBeChecked();
  await expect(page.locator('#guide-reminders')).not.toBeChecked();
  await expect(page.locator('#add')).toContainText('通过网址添加');
  await page.evaluate(() => window.guide.update({ app: 'iphone' }));
  await expect(page.locator('#guide-seen')).toBeChecked();
  await expect(page.locator('#guide-reminders')).toBeChecked();
  expect(await page.evaluate(() => window.guide.getState().expanded.iphone)).toBe(true);
  await expect(page.locator('[data-guide-status]')).not.toContainText('订阅成功');
});

test('display-only hides reminder guidance and test, preserves prior user checks when restored', async ({ page }) => {
  await fixture(page, { app: 'google', progress: { google: { seen: true, reminders: true } } });
  await page.evaluate(() => window.guide.update({ hasReminders: false }));
  await expect(page.locator('#guide-seen')).toBeChecked();
  await expect(page.locator('#guide-reminders,[data-guide-expand],#test-reminder')).toHaveCount(0);
  await expect(page.locator('#notifications')).toContainText('已跳过通知设置');
  await page.evaluate(() => window.guide.update({ hasReminders: true }));
  await expect(page.locator('#guide-reminders')).toBeChecked();
  await page.locator('.guide-test > summary').click();
  await page.locator('#test-reminder').click();
  expect(await page.evaluate(() => window.guideTests)).toBe(1);
  await page.evaluate(() => window.guide.setTestStatus('测试文件已生成，请在手机导入。'));
  await expect(page.locator('#test-status')).toHaveText('测试文件已生成，请在手机导入。');
});

test('other calendars show direct brand help without changing existing checks or subscription preferences', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await fixture(page, { app: 'other', brand: 'huawei', progress: { other: { seen: true, reminders: true } } });
  await expect(page.locator('#guide-brand')).toHaveCount(0);
  await expect(page.locator('#guide-seen')).toBeChecked();
  await expect(page.locator('#guide-reminders')).toBeChecked();
  expect(await page.evaluate(() => Object.hasOwn(window.guide.getState(), 'brand'))).toBe(false);
  await expect(page.locator('.guide-method')).toHaveCount(2);
  const initialState = await page.evaluate(() => window.guide.getState());
  const initialNotifications = await page.evaluate(() => window.guideStates.length);
  for (const key of ['huawei-import', 'oppo-subscribe', 'xiaomi-check']) {
    const help = page.locator(`[data-guide-help="${key}"]`);
    await help.locator('summary').click();
    await expect(help).toHaveAttribute('open', '');
    expect(await page.evaluate(() => window.guide.getState())).toEqual(initialState);
    expect(await page.evaluate(() => window.guideStates.length)).toBe(initialNotifications);
  }
  await expect(page.locator('[data-guide-help="huawei-import"]')).toContainText('HarmonyOS 5.0、5.1、6.0、6.1');
  await expect(page.locator('[data-guide-help="huawei-import"]')).toContainText('从文件导入');
  await expect(page.locator('[data-guide-help="huawei-import"]')).toContainText('接收');
  await expect(page.locator('[data-guide-help="oppo-subscribe"]')).toContainText('一加 9RT 的 ColorOS 12');
  await expect(page.locator('[data-guide-help="oppo-subscribe"]')).toContainText('这是网址订阅步骤');
  await expect(page.locator('[data-guide-help="xiaomi-check"]')).toContainText('目前未确认');
  await expect(page.locator('#add')).toContainText('文件导入不会持续更新');
  // Refreshing subscription availability and returning to the app preserve both
  // independent confirmations and the accordion the reader was using.
  await page.evaluate(() => window.guide.update({ hasSubscription: true }));
  await expect(page.locator('[data-guide-help="oppo-subscribe"]')).toHaveAttribute('open', '');
  await page.evaluate(() => { window.guide.update({ app: 'google' }); window.guide.update({ app: 'other' }); });
  await expect(page.locator('#guide-seen')).toBeChecked();
  await expect(page.locator('#guide-reminders')).toBeChecked();
  await page.locator('[data-guide-expand] > summary').click();
  await page.getByText('华为 HarmonyOS 6.0 通知入口', { exact: true }).click();
  await expect(page.locator('.guide-notification-body')).toContainText('其他版本请使用上方通用步骤');
  await expect(page.locator('.guide-notification-body')).toContainText('各品牌的菜单名称可能因版本不同而变化');
  await page.getByText('找不到这个入口', { exact: true }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await expect(page.locator('[href^="app-settings:"],[href^="intent:"]')).toHaveCount(0);
});

test('method shortcuts reach existing controls without generating subscriptions or assuming success', async ({ page }) => {
  await fixture(page, { app: 'other' });
  await page.locator('[data-guide-help="adding-other"] > summary').click();
  await page.evaluate(() => {
    const controls = document.createElement('div');
    controls.innerHTML = '<button id="create-subscription">重试准备订阅</button><input id="feed-url" readonly value="https://calendar.example/test.ics"><details class="download-fallback"><summary>使用文件导入</summary><div id="downloads"><button id="download-file">下载文件</button></div></details>';
    document.body.append(controls);
    window.actualActions = 0;
    controls.addEventListener('click', () => { window.actualActions += 1; });
  });
  await page.locator('[data-guide-jump="subscription"]').click();
  await expect(page.locator('#create-subscription')).toBeFocused();
  await page.locator('[data-guide-jump="file"]').click();
  await expect(page.locator('.download-fallback')).toHaveAttribute('open', '');
  await expect(page.locator('#download-file')).toBeFocused();
  await page.evaluate(() => window.guide.update({ hasSubscription: true }));
  await page.locator('[data-guide-jump="subscription"]').click();
  await expect(page.locator('#feed-url')).toBeFocused();
  expect(await page.evaluate(() => window.actualActions)).toBe(0);
  await expect(page.locator('#guide-seen')).not.toBeChecked();
  await expect(page.locator('#guide-reminders')).not.toBeChecked();
});
