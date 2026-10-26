import {test,expect} from '@playwright/test';
const route='/calendar-reminders/';
const fits=async page=>expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
async function dialogFits(page,id){expect(await page.locator(id).evaluate(node=>node.scrollWidth<=node.clientWidth)).toBe(true);}

test('compact selection fits phone first screen and preview starts directly with calendar controls',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await page.goto(route);await expect(page.locator('#app')).toBeVisible();
  await expect(page.locator('.action-buttons #clear-selection')).toBeVisible();
  await expect(page.locator('#selection-pane #preset-options')).toBeVisible();
  const layout=await page.evaluate(()=>({
    category:document.querySelector('.group-card>summary').getBoundingClientRect().bottom,
    bar:document.querySelector('.action-bar').getBoundingClientRect().top
  }));
  expect(layout.category).toBeLessThan(layout.bar);
  await expect(page.locator('#search,#reset')).toHaveCount(0);
  await page.locator('[data-preset="practice"]').click();
  await expect(page.locator('#selection-count')).toHaveText('已选 54 项');
  await expect(page.locator('#reminder-count')).toHaveText('2 项提醒');
  await page.locator('#tab-preview').click();
  await expect(page.locator('#preset-options')).toBeHidden();
  await expect(page.locator('[data-cal-month]')).toBeVisible();
  expect((await page.locator('.cal-control-bar').boundingBox()).y).toBeLessThan(300);
  await page.screenshot({path:'.calendar-preview/modern-mobile-preview.png',fullPage:true});
  await page.locator('.skip').focus();await page.keyboard.press('Enter');
  await expect(page.locator('[data-preset="guru"]')).toBeFocused();await expect(page.locator('#preset-options')).toBeVisible();
  const reminder=page.locator('[data-reminder-event="guru-tsok"]');
  await reminder.click();await page.locator('#reminder-form button[type="submit"]').click();
  await expect(reminder).toBeFocused();
  await page.locator('#tab-preview').click();await page.locator('[data-cal-view="list"]').click();
  const card=page.locator('.cal-list-view [data-cal-event]').first(),key=await card.getAttribute('data-cal-focus');
  await card.click();await page.locator('#reminder-form button[type="submit"]').click();
  await expect(page.locator(`[data-cal-focus="${key}"]`)).toBeFocused();
  await page.locator('#tab-selection').click();await page.evaluate(()=>scrollTo(0,0));
  await page.screenshot({path:'.calendar-preview/modern-mobile-selection.png',fullPage:true});
  const categoryIcon=await page.locator('[data-reminder-group="tsok"] svg').innerHTML();
  expect(categoryIcon).not.toBe(await page.locator('[data-reminder-event="guru-tsok"] svg').innerHTML());
  await page.locator('#tab-preview').click();await page.locator('#clear-selection').click();
  await expect(page.locator('#selection-count')).toHaveText('已选 0 项');
  await expect(page.locator('#clear-selection')).toBeDisabled();
  await expect(page.locator('[data-cal-view="month"]')).toBeFocused();
  await expect(page.locator('#preview-pane')).toBeVisible();
});

test('breakpoints preserve readable selection, complete month grid and reachable bottom content',async({page})=>{
  await page.goto(route);await expect(page.locator('#app')).toBeVisible();
  for(const width of [320,390,768,1024,1440]){
    await page.setViewportSize({width,height:844});
    if(width<1024){await page.locator('#tab-selection').click();await expect(page.locator('#preview-pane')).toBeHidden();}
    else{await expect(page.locator('#preview-pane')).toBeVisible();await expect(page.locator('.mobile-tabs')).toBeHidden();}
    await fits(page);
    const masters=page.locator('[data-group-id="masters"]');
    if(!await masters.evaluate(node=>node.open))await masters.locator('summary').click();
    await page.locator('[data-event="jigme-lingpa"]').check();
    await page.locator('[data-reminder-event="jigme-lingpa"]').click();
    await expect(page.locator('#reminder-title')).toContainText('持明无畏洲');
    await dialogFits(page,'#reminder-dialog');
    await page.locator('[data-close="reminder-dialog"]').first().click();
    if(width<1024)await page.locator('#tab-preview').click();
    await expect(page.locator('.cal-day')).toHaveCount(42);await fits(page);
    // Align explicitly: "if needed" only checks the viewport, not the fixed action bar.
    await page.locator('footer').evaluate(node=>node.scrollIntoView({block:'end'}));
    const rects=await page.evaluate(()=>({footer:document.querySelector('footer').getBoundingClientRect().bottom,bar:document.querySelector('.action-bar').getBoundingClientRect().top}));
    expect(rects.footer).toBeLessThanOrEqual(rects.bar);
    await page.screenshot({path:`.calendar-preview/layout-${width}.png`,fullPage:true});
  }
});

test('landscape and keyboard-sized screens keep every form action and Chinese guide reachable',async({page})=>{
  await page.goto(route);await expect(page.locator('#app')).toBeVisible();
  await page.locator('[data-preset="guru"]').click();
  for(const size of [{width:844,height:390},{width:390,height:400},{width:1440,height:500}]){
    await page.setViewportSize(size);if(size.width<1024)await page.locator('#tab-selection').click();
    await page.locator('#zone-settings').click();await page.locator('#zone-search').fill('Eucla');
    await page.locator('input[value="Australia/Eucla"]').check();await dialogFits(page,'#zone-dialog');await page.locator('#apply-zone').click();
    await page.locator('[data-reminder-group="tsok"]').click();await page.locator('#add-reminder').click();
    await page.locator('[data-reminder-index="1"][data-reminder-field="time"]').fill('20:30');
    await dialogFits(page,'#reminder-dialog');await page.locator('#reminder-form button[type="submit"]').click();
    await page.locator('#subscribe').click();await page.locator('input[name="device"][value="other"]').check();
    const brand=page.locator('[data-guide-help="huawei-import"]');
    if(!await brand.evaluate(node=>node.open))await brand.locator('summary').click();
    if(!await page.locator('[data-guide-expand]').evaluate(node=>node.open))await page.locator('[data-guide-expand]>summary').click();
    const help=page.locator('.guide-help').filter({has:page.getByText('找不到这个入口',{exact:true})});
    if(!await help.evaluate(node=>node.open))await page.getByText('找不到这个入口',{exact:true}).click();
    await dialogFits(page,'#subscription-dialog');
    await page.locator('#guide-reminders').check();
    await page.locator('[data-close="subscription-dialog"]').last().click();
    await fits(page);
    // Start next iteration with a single alarm; this also checks return-to-edit.
    await page.locator('[data-reminder-group="tsok"]').click();await page.locator('[data-remove-reminder="1"]').click();await page.locator('#reminder-form button[type="submit"]').click();
  }
});

test('200 percent equivalent desktop reflow and keyboard navigation remain operable',async({browser})=>{
  const context=await browser.newContext({viewport:{width:720,height:450},deviceScaleFactor:2,baseURL:'http://127.0.0.1:4173'});
  try{
    const page=await context.newPage();await page.goto(route);await expect(page.locator('#app')).toBeVisible();
    await page.locator('[data-preset="guru"]').click();
    await page.locator('#tab-preview').focus();await page.keyboard.press('Enter');
    await page.locator('[data-cal-view="list"]').focus();await page.keyboard.press('Enter');await expect(page.locator('.cal-list-view')).toBeVisible();
    await page.locator('#subscribe').click();await page.locator('input[name="device"][value="google"]').check();
    await page.locator('[data-guide-expand]>summary').focus();await page.keyboard.press('Enter');await expect(page.locator('.guide-notification-body')).toBeVisible();
    await dialogFits(page,'#subscription-dialog');await page.keyboard.press('Escape');await expect(page.locator('#subscription-dialog')).toBeHidden();await fits(page);
  }finally{await context.close();}
});
