import { test, expect } from '@playwright/test';

// This suite verifies website routing and state only. It does not launch an OS
// calendar, prove that a feed was subscribed, or verify a delivered notification.
const origin = 'http://127.0.0.1:4173';
const appPath = '/calendar-reminders/';
const read = (page, key = 'huideng.calendar.subscription') => page.evaluate(key => JSON.parse(localStorage.getItem(key)), key);
const devices = {
  iphone: { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1', platform: 'iPhone', touch: 5, viewport: { width: 390, height: 844 } },
  ipad: { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15', platform: 'MacIntel', touch: 5, viewport: { width: 768, height: 1024 } },
  mac: { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15', platform: 'MacIntel', touch: 0, viewport: { width: 1440, height: 1000 } },
  android: { userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/130.0.0.0 Mobile Safari/537.36', platform: 'Linux armv8l', touch: 5, viewport: { width: 390, height: 844 } }
};

async function deviceContext(browser, device, savedApp) {
  const context = await browser.newContext({ baseURL: origin, timezoneId: 'Asia/Shanghai', userAgent: device.userAgent, viewport: device.viewport });
  await context.addInitScript(({ platform, touch, savedApp }) => {
    Object.defineProperty(navigator, 'platform', { configurable: true, get: () => platform });
    Object.defineProperty(navigator, 'maxTouchPoints', { configurable: true, get: () => touch });
    if (savedApp && !localStorage.getItem('huideng.calendar.interface')) localStorage.setItem('huideng.calendar.interface', JSON.stringify({ app: savedApp, guide: { app: savedApp } }));
  }, { ...device, savedApp });
  return context;
}

// Retain the real local API and capability generation. Only replace the returned
// feed origin, so the HTTPS-only native entry can be exercised without deploying.
async function httpsService(page, { failFirst = false, holdFirst = false } = {}) {
  let release;
  const gate = holdFirst ? new Promise(resolve => { release = resolve; }) : Promise.resolve();
  const state = { posts: 0, received: false, release: () => release?.() };
  await page.route('**/api/subscriptions**', async route => {
    const creation = route.request().method() === 'POST';
    if (creation) {
      state.posts += 1;
      if (failFirst && state.posts === 1) {
        await route.fulfill({ status: 503, json: { error: '暂时无法连接订阅服务，请重试。' } });
        return;
      }
    }
    const response = await route.fetch();
    const body = await response.json();
    if (creation && state.posts === 1) { state.received = true; await gate; }
    if (body.feedUrl) {
      const url = new URL(body.feedUrl);
      body.feedUrl = `https://calendar.example${url.pathname}${url.search}`;
    }
    await route.fulfill({ response, json: body });
  });
  return state;
}

async function openSelected(page) {
  await page.goto(appPath);
  await expect(page.locator('#app')).toBeVisible();
  await page.locator('[data-preset="guru"]').click();
}

async function ready(page) {
  await expect(page.locator('#subscription-existing')).toBeVisible();
  await expect(page.locator('#copy-feed')).toBeEnabled();
  await expect(page.locator('#feed-url')).toHaveValue(/^https:\/\/calendar\.example\/calendar\/.+\.ics$/);
  await expect(page.locator('#subscription-status')).toContainText('设置已保存');
  return read(page);
}

for (const [name, device] of Object.entries(devices).filter(([name]) => name !== 'android')) {
  test(`simulated ${name}: prepares once and exposes a real Apple subscription link without implying success`, async ({ browser }) => {
    const context = await deviceContext(browser, device);
    try {
      const page = await context.newPage();
      const service = await httpsService(page);
      await openSelected(page);
      // Merely visiting and selecting a preset must not create a remote record.
      expect(service.posts).toBe(0);
      await page.locator('#subscribe').click();
      await expect(page.locator('input[name="device"][value="iphone"]')).toBeChecked();
      const sub = await ready(page);
      const entry = page.locator('#iphone-subscribe');
      await expect(entry).toBeVisible();
      await expect(entry).toHaveText('打开 Apple 日历订阅');
      await expect(entry).toHaveAttribute('href', sub.feedUrl.replace(/^https:/, 'webcal:'));
      expect(await entry.getAttribute('href')).not.toContain(sub.manageToken);
      await expect(page.locator('#copy-feed')).toBeVisible();
      await expect(page.locator('#guide-seen')).not.toBeChecked();
      await entry.evaluate(node => node.addEventListener('click', event => {
        event.preventDefault();
        window.observedCalendarClick = { trusted: event.isTrusted, href: node.href };
      }));
      await entry.click();
      expect(await page.evaluate(() => window.observedCalendarClick)).toEqual({ trusted: true, href: sub.feedUrl.replace(/^https:/, 'webcal:') });
      await page.evaluate(() => { window.dispatchEvent(new Event('blur')); window.dispatchEvent(new Event('focus')); document.dispatchEvent(new Event('visibilitychange')); });
      await expect(page.locator('#guide-seen')).not.toBeChecked();
      await expect(page.locator('#guide-reminders')).not.toBeChecked();
      await expect(page.locator('[data-guide-status]')).not.toContainText('订阅成功');
      await page.locator('[data-close="subscription-dialog"]').first().click();
      await page.locator('#subscribe').click();
      expect(service.posts).toBe(1);
      expect((await read(page)).feedUrl).toBe(sub.feedUrl);
      if (name === 'mac') {
        await page.locator('[data-guide-expand] > summary').click();
        await expect(page.locator('.guide-notification-body')).toContainText('Mac');
        await expect(page.locator('.guide-notification-body')).not.toContainText('请拿起手机');
      }
    } finally { await context.close(); }
  });
}

test('remembered Google choice overrides Apple recommendation and desktop opens the official add-by-url page', async ({ browser }) => {
  const context = await deviceContext(browser, devices.mac, 'google');
  try {
    const page = await context.newPage(); const service = await httpsService(page);
    await openSelected(page); await page.locator('#subscribe').click();
    const sub = await ready(page);
    await expect(page.locator('input[name="device"][value="google"]')).toBeChecked();
    await expect(page.locator('#iphone-subscribe')).toBeHidden();
    await expect(page.locator('#google-subscribe')).toBeVisible();
    await expect(page.locator('#google-subscribe')).toHaveAttribute('href', 'https://calendar.google.com/calendar/u/0/r/settings/addbyurl');
    await expect(page.locator('a[href*="cid="]')).toHaveCount(0);
    expect(await page.locator('#google-subscribe').getAttribute('href')).not.toContain(sub.manageToken);
    await page.locator('input[name="device"][value="iphone"]').check();
    await expect(page.locator('#iphone-subscribe')).toBeVisible();
    await page.locator('input[name="device"][value="other"]').check();
    await expect(page.locator('#iphone-subscribe,#google-subscribe').filter({ visible: true })).toHaveCount(0);
    expect(service.posts).toBe(1);
    expect((await read(page)).feedUrl).toBe(sub.feedUrl);
    await page.reload(); await page.locator('#my-subscription').click();
    await expect(page.locator('input[name="device"][value="other"]')).toBeChecked();
    expect(service.posts).toBe(1);
  } finally { await context.close(); }
});

test('Android Google uses a computer handoff and other calendars expose explicit copy and import actions', async ({ browser, browserName }) => {
  const context = await deviceContext(browser, devices.android);
  try {
    if (browserName === 'chromium') await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    else await context.addInitScript(() => {
      // Firefox/WebKit automation cannot grant Chromium clipboard permissions.
      // Check the UI's exact copy payload with an explicit clipboard adapter;
      // real OS clipboard behavior remains a device acceptance item.
      let copied='';
      Object.defineProperty(navigator,'clipboard',{value:{writeText:async text=>{copied=text;},readText:async()=>copied},configurable:true});
    });
    const page = await context.newPage(); const service = await httpsService(page);
    await openSelected(page); await page.locator('#subscribe').click();
    expect(service.posts).toBe(0);
    await page.locator('input[name="device"][value="google"]').check();
    const sub = await ready(page);
    await expect(page.locator('#google-subscribe')).toBeHidden();
    await expect(page.locator('#device-guide')).toContainText('电脑');
    await expect(page.locator('#device-guide')).toContainText('手机');
    await expect(page.locator('a[href*="cid="],a[href^="intent:"]')).toHaveCount(0);
    await page.locator('#copy-feed').click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(sub.feedUrl);
    await expect(page.locator('#guide-seen')).not.toBeChecked();
    await page.locator('input[name="device"][value="other"]').check();
    await expect(page.locator('#iphone-subscribe')).toBeHidden();
    await expect(page.locator('#google-subscribe')).toBeHidden();
    await expect(page.locator('#copy-feed')).toHaveText('复制订阅地址');
    await expect(page.locator('.download-fallback')).toContainText('文件不会持续更新');
    await page.locator('.download-fallback > summary').click();
    await expect(page.locator('[data-download="remind"]')).toBeVisible();
    await expect(page.locator('#guide-seen')).not.toBeChecked();
    expect(service.posts).toBe(1);
  } finally { await context.close(); }
});

test('slow preparation survives closing and app changes without duplicate creation or automatic navigation', async ({ browser }) => {
  const context = await deviceContext(browser, devices.iphone);
  let service;
  try {
    const page = await context.newPage(); service = await httpsService(page, { holdFirst: true });
    await openSelected(page); await page.locator('#subscribe').click();
    await expect.poll(() => service.received).toBe(true);
    await expect(page.locator('#create-subscription')).toBeDisabled();
    await expect(page.locator('#iphone-subscribe')).toBeHidden();
    // Exercise the race as one browser turn, without host/automation delays
    // accidentally crossing the application's real 15-second network timeout.
    await page.evaluate(()=>{
      document.querySelector('input[name="device"][value="google"]').click();
      document.querySelector('[data-close="subscription-dialog"]').click();
      document.querySelector('#my-subscription').click();
      document.querySelector('input[name="device"][value="iphone"]').click();
    });
    expect(service.posts).toBe(1);
    service.release(); await ready(page);
    await expect(page.locator('#iphone-subscribe')).toBeVisible();
    await expect(page).toHaveURL(origin + appPath);
    await expect(page.locator('#guide-seen')).not.toBeChecked();
    expect(service.posts).toBe(1);
  } finally { service?.release(); await context.close(); }
});

test('failed preparation preserves choices and explicit retry creates one usable subscription', async ({ browser }) => {
  const context = await deviceContext(browser, devices.iphone);
  try {
    const page = await context.newPage(); const service = await httpsService(page, { failFirst: true });
    await openSelected(page); const draft = await read(page, 'huideng.calendar.v2');
    await page.locator('#subscribe').click();
    await expect(page.locator('#subscription-error')).toContainText('请重试');
    await expect(page.locator('#create-subscription')).toBeEnabled();
    await expect(page.locator('#iphone-subscribe')).toBeHidden();
    expect(await read(page)).toBeNull();
    expect(await read(page, 'huideng.calendar.v2')).toEqual(draft);
    await page.locator('input[name="device"][value="google"]').check();
    await page.locator('input[name="device"][value="iphone"]').check();
    expect(service.posts).toBe(1);
    await page.locator('#create-subscription').click();
    await ready(page);
    await expect(page.locator('#subscription-error')).toBeHidden();
    await expect(page.locator('#iphone-subscribe')).toBeVisible();
    await expect(page.locator('#guide-seen')).not.toBeChecked();
    expect(service.posts).toBe(2);
    expect(await read(page, 'huideng.calendar.v2')).toEqual(draft);
  } finally { await context.close(); }
});

test('unsaved and failed settings disable Apple launch until saving the same subscription succeeds', async ({ browser }) => {
  const context = await deviceContext(browser, devices.iphone);
  try {
    const page = await context.newPage(); const service = await httpsService(page);
    await openSelected(page); await page.locator('#subscribe').click(); const original = await ready(page);
    await page.locator('[data-close="subscription-dialog"]').first().click();
    await page.locator('[data-preset="tsok"]').click();
    await page.locator('#my-subscription').click();
    await expect(page.locator('#save-subscription')).toBeVisible();
    await expect(page.locator('#iphone-subscribe')).not.toHaveAttribute('href', /^webcal:/);
    const failSave = route => route.request().method() === 'PATCH'
      ? route.fulfill({ status: 503, json: { error: '保存失败，请重试。' } }) : route.fallback();
    await page.route('**/api/subscriptions/*', failSave);
    await page.locator('#save-subscription').click();
    await expect(page.locator('#subscription-error')).toContainText('保存失败');
    await expect(page.locator('#iphone-subscribe')).not.toHaveAttribute('href', /^webcal:/);
    expect((await read(page, 'huideng.calendar.v2')).events['dakini-tsok'].mode).toBe('remind');
    expect((await read(page)).revision).toBe(original.revision);
    await page.unroute('**/api/subscriptions/*', failSave);
    await page.locator('#save-subscription').click();
    await expect.poll(async () => (await read(page)).revision).toBe(original.revision + 1);
    await expect(page.locator('#iphone-subscribe')).toHaveAttribute('href', original.feedUrl.replace(/^https:/, 'webcal:'));
    expect((await read(page)).feedUrl).toBe(original.feedUrl);
    expect(service.posts).toBe(1);
  } finally { await context.close(); }
});

test('clipboard denial offers a selectable read-only URL without implying subscription success', async ({ browser }) => {
  const context=await deviceContext(browser,devices.iphone);
  try {
    const page=await context.newPage();await httpsService(page);
    await openSelected(page);await page.locator('#subscribe').click();const sub=await ready(page);
    await page.evaluate(()=>{
      Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:()=>Promise.reject(new Error('denied'))}});
      document.execCommand=()=>{throw new Error('disabled');};
    });
    await page.locator('#copy-feed').click();
    const manual=page.locator('#subscription-error input');
    await expect(manual).toHaveValue(sub.feedUrl);
    await expect(manual).toBeFocused();
    await expect(manual).toHaveAttribute('readonly','');
    expect(await manual.inputValue()).not.toContain(sub.manageToken);
    await expect(page.locator('#guide-seen')).not.toBeChecked();
  }finally{await context.close();}
});

test('in-app browser help is explicit and never fabricates an external-browser or calendar success callback', async ({ browser }) => {
  const context = await deviceContext(browser, { ...devices.iphone, userAgent: devices.iphone.userAgent + ' MicroMessenger/8.0.50' });
  try {
    const page = await context.newPage(); await httpsService(page);
    await openSelected(page); await page.locator('#subscribe').click(); await ready(page);
    const help = page.locator('[data-guide-help="open-failed"]');
    await help.locator('summary').click();
    await expect(help).toContainText('微信');
    await expect(help).toContainText('浏览器');
    await expect(help).toContainText('Safari');
    await expect(page.locator('a[href^="app-settings:"],a[href^="intent:"],a[href^="x-safari-"]')).toHaveCount(0);
    await page.locator('#copy-feed').click();
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await expect(page.locator('#guide-seen')).not.toBeChecked();
    await expect(page.locator('#guide-reminders')).not.toBeChecked();
  } finally { await context.close(); }
});

async function createRemoteB(context, source) {
  const settings = structuredClone(source.savedSettings);
  settings.zone = 'America/Vancouver';
  settings.events['guru-tsok'].mode = 'display';
  const response = await context.request.post(`${origin}/api/subscriptions`, {
    headers: { Origin: origin }, data: { settings }
  });
  expect(response.status()).toBe(201);
  const result = await response.json();
  const feed = new URL(result.feedUrl);
  return { ...result, settings, expectedFeed: `https://calendar.example${feed.pathname}${feed.search}` };
}

async function holdOperation(page, subscription, method, order) {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const state = { received: false, delivered: false, release };
  await page.route(`**/api/subscriptions/${subscription.id}`, async route => {
    if (route.request().method() !== method) { await route.fallback(); return; }
    const response = await route.fetch();
    const body = await response.json();
    if (body.feedUrl) {
      const url = new URL(body.feedUrl);
      body.feedUrl = `https://calendar.example${url.pathname}${url.search}`;
    }
    state.received = true;
    await gate;
    order.push(`release ${method} A`);
    await route.fulfill({ response, json: body });
    state.delivered = true;
  });
  return state;
}

async function switchToManagementB(page, b) {
  await page.evaluate(({ id, token }) => { location.hash = `manage=${id}.${token}`; }, { id: b.id, token: b.manageToken });
  // Hash removal proves the restore handler ran; it must not leak the capability
  // into API URLs or retain it in a shareable address bar.
  await expect(page).toHaveURL(origin + appPath);
}

async function expectB(page, b) {
  await expect.poll(async () => (await read(page))?.id).toBe(b.id);
  const sub = await read(page);
  expect(sub.manageToken).toBe(b.manageToken);
  expect(sub.feedUrl).toBe(b.expectedFeed);
  expect(sub.savedSettings).toEqual(b.settings);
  expect(await read(page, 'huideng.calendar.v2')).toEqual(b.settings);
  await expect(page.locator('#feed-url')).toHaveValue(b.expectedFeed);
  await expect(page.locator('#iphone-subscribe')).toHaveAttribute('href', b.expectedFeed.replace(/^https:/, 'webcal:'));
}

test('management restore waits for a delayed save and keeps B id, token, draft and stable feed paired', async ({ browser }) => {
  const context = await deviceContext(browser, devices.iphone);
  let held;
  try {
    const page = await context.newPage(); await httpsService(page);
    await openSelected(page); await page.locator('#subscribe').click(); const a = await ready(page);
    const b = await createRemoteB(context, a);
    const order = [], bRequests = [], leaked = [];
    page.on('request', request => {
      if (request.url().endsWith(`/api/subscriptions/${b.id}`)) {
        order.push(`${request.method()} B`);
        bRequests.push({ method: request.method(), authorization: request.headers().authorization });
      }
      if (request.url().includes(a.manageToken) || request.url().includes(b.manageToken)) leaked.push(request.url());
    });
    await page.locator('[data-close="subscription-dialog"]').first().click();
    await page.locator('[data-preset="tsok"]').click();
    held = await holdOperation(page, a, 'PATCH', order);
    await page.locator('#subscribe').click(); await expect.poll(() => held.received).toBe(true);
    await switchToManagementB(page, b);
    await expect(page.locator('#iphone-subscribe')).not.toHaveAttribute('href', /^webcal:/);
    await expect(page.locator('#entry-hint')).toHaveText('正在恢复订阅，请稍候。');
    await expect(page.locator('#subscribe-label')).toHaveText('正在恢复订阅…');
    await expect(page.locator('#subscribe')).toBeDisabled();
    await expect(page.locator('#my-subscription')).toBeEnabled();
    held.release(); await expectB(page, b);
    expect(order.indexOf('GET B')).toBeGreaterThan(order.indexOf('release PATCH A'));
    expect((await context.request.get(`${origin}/api/subscriptions/${a.id}`, { headers: { Authorization: `Bearer ${a.manageToken}` } })).ok()).toBe(true);
    await page.locator('[data-close="subscription-dialog"]').first().click();
    await page.locator('[data-preset="tsok"]').click(); await page.locator('#subscribe').click();
    await expect.poll(async () => (await read(page))?.revision).toBe(b.revision + 1);
    const saved = await read(page);
    expect(saved.id).toBe(b.id); expect(saved.manageToken).toBe(b.manageToken); expect(saved.feedUrl).toBe(b.expectedFeed);
    expect(saved.savedSettings.events['dakini-tsok'].mode).toBe('remind');
    expect(saved.savedSettings.zone).toBe('America/Vancouver');
    expect(await read(page, 'huideng.calendar.v2')).toEqual(saved.savedSettings);
    expect(bRequests.filter(request => request.method === 'PATCH')).toHaveLength(1);
    expect(bRequests.every(request => request.authorization === `Bearer ${b.manageToken}`)).toBe(true);
    expect(leaked).toEqual([]);
  } finally { held?.release(); await context.close(); }
});

test('delayed deletion of A completes before restoring B and cannot clear B credentials or settings', async ({ browser }) => {
  const context = await deviceContext(browser, devices.iphone);
  let held;
  try {
    const page = await context.newPage(); await httpsService(page);
    await openSelected(page); await page.locator('#subscribe').click(); const a = await ready(page);
    const b = await createRemoteB(context, a), order = [];
    page.on('request', request => { if (request.url().endsWith(`/api/subscriptions/${b.id}`)) order.push(`${request.method()} B`); });
    held = await holdOperation(page, a, 'DELETE', order);
    await page.locator('.management > summary').click();
    await page.locator('#stop-subscription').click(); await page.locator('#confirm-stop').click();
    await expect.poll(() => held.received).toBe(true);
    await switchToManagementB(page, b);
    held.release(); await expectB(page, b);
    expect(order.indexOf('GET B')).toBeGreaterThan(order.indexOf('release DELETE A'));
    await expect(page.locator('#save-state')).not.toContainText('已停用');
    const deleted = await context.request.get(`${origin}/api/subscriptions/${a.id}`, { headers: { Authorization: `Bearer ${a.manageToken}` } });
    expect((await deleted.json()).disabled).toBe(true);
    const remoteB = await context.request.get(`${origin}/api/subscriptions/${b.id}`, { headers: { Authorization: `Bearer ${b.manageToken}` } });
    expect((await remoteB.json()).disabled).toBe(false);
  } finally { held?.release(); await context.close(); }
});

test('a late initial GET for A cannot overwrite B after a management-link restore', async ({ browser }) => {
  const context = await deviceContext(browser, devices.iphone);
  let held;
  try {
    const page = await context.newPage(); await httpsService(page);
    await openSelected(page); await page.locator('#subscribe').click(); const a = await ready(page);
    const b = await createRemoteB(context, a), order = [];
    held = await holdOperation(page, a, 'GET', order);
    await page.reload(); await expect(page.locator('#app')).toBeVisible();
    await expect.poll(() => held.received).toBe(true);
    await page.evaluate(() => { location.hash = 'manage=incomplete'; });
    await expect(page.locator('#subscription-error')).toContainText('管理链接不完整');
    await switchToManagementB(page, b); await expectB(page, b);
    await expect(page.locator('#subscription-error')).toBeHidden();
    const staleResponse = page.waitForResponse(response => response.url().endsWith(`/api/subscriptions/${a.id}`) && response.request().method() === 'GET');
    held.release(); await staleResponse; await expect.poll(() => held.delivered).toBe(true);
    // Let JSON parsing/state microtasks and their following paint finish. This is
    // a website race assertion, not a synthetic OS callback or a fixed sleep.
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await expectB(page, b);
    await expect(page.locator('#subscription-error')).toBeHidden();
    await expect(page.locator('#save-state')).not.toContainText('未保存');
  } finally { held?.release(); await context.close(); }
});

test('successful stop clears a previous error and allows a new explicit subscription', async ({ browser }) => {
  const context = await deviceContext(browser, devices.iphone);
  try {
    const page = await context.newPage(); const service = await httpsService(page);
    await openSelected(page); await page.locator('#subscribe').click(); const a = await ready(page);
    await page.evaluate(() => { location.hash = 'manage=incomplete'; });
    await expect(page.locator('#subscription-error')).toContainText('管理链接不完整');
    await page.locator('.management > summary').click();
    await page.locator('#stop-subscription').click(); await page.locator('#confirm-stop').click();
    await expect.poll(() => read(page)).toBeNull();
    await expect(page.locator('#subscription-error')).toBeHidden();
    await page.locator('[data-close="subscription-dialog"]').first().click();
    await page.locator('#subscribe').click(); const replacement = await ready(page);
    expect(replacement.id).not.toBe(a.id);
    expect(service.posts).toBe(2);
    await expect(page.locator('#subscription-error')).toBeHidden();
    await expect(page.locator('#guide-seen')).not.toBeChecked();
  } finally { await context.close(); }
});
