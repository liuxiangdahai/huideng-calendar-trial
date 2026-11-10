import {test,expect} from '@playwright/test';
test('mobile sticky tabs preserve independent panel positions, month and focused controls',async({page})=>{
 const tapTab=async id=>{const b=await page.locator(id).boundingBox();await page.mouse.click(b.x+b.width/2,b.y+b.height/2);};
 await page.setViewportSize({width:390,height:844});await page.goto('/calendar-reminders/');await expect(page.locator('#app')).toBeVisible();
 await page.locator('[data-preset="practice"]').click();
 await page.locator('#advanced-settings>summary').click();
 const group=page.locator('[data-group-id="masters"]');await group.locator('summary').click();
 await page.locator('.title-marks').scrollIntoViewIfNeeded();
 await expect.poll(()=>page.locator('.mobile-tabs').evaluate(n=>Math.round(n.getBoundingClientRect().top))).toBe(0);
 const saved=await page.evaluate(()=>scrollY);
 await tapTab('#tab-preview');
 const toolbar=await page.locator('.cal-control-bar').boundingBox(),tabs=await page.locator('.mobile-tabs').boundingBox();
 expect(toolbar.y).toBeGreaterThanOrEqual(tabs.y+tabs.height-1);expect(toolbar.y).toBeLessThan(140);
 await page.locator('[data-cal-action="next"]').click();const month=await page.locator('[data-cal-month]').inputValue();
 await page.locator('[data-cal-grid] .cal-week:last-child').scrollIntoViewIfNeeded();const preview=await page.evaluate(()=>scrollY);
 // A short month may not scroll far enough to pin the bar; then the preview is
 // simply at its start, and returning shows it from the start with the bar pinned.
 const previewPinned=await page.locator('.mobile-tabs').evaluate(n=>n.getBoundingClientRect().top<=1);
 await tapTab('#tab-selection');await expect.poll(()=>page.evaluate(()=>scrollY)).toBeCloseTo(saved,0);
 await expect(group).toHaveAttribute('open','');
 await tapTab('#tab-preview');await expect(page.locator('[data-cal-month]')).toHaveValue(month);
 if(previewPinned)await expect.poll(()=>page.evaluate(()=>scrollY)).toBeCloseTo(preview,0);
 else{const [bar,controls]=await Promise.all(['.mobile-tabs','.cal-control-bar'].map(s=>page.locator(s).boundingBox()));
  expect(controls.y).toBeGreaterThanOrEqual(bar.y+bar.height-1);expect(controls.y).toBeLessThan(bar.y+bar.height+40);}
 await page.locator('#tab-preview').press('ArrowLeft');await expect(page.locator('#tab-selection')).toBeFocused();
 await page.locator('#subscribe').click();await expect(page.locator('#subscription-dialog')).toBeVisible();
 await page.keyboard.press('Escape');await expect(page.locator('#subscription-dialog')).toBeHidden();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('the tab bar never moves when 选择内容 or 日期预览 is tapped',async({page}) => {
  await page.setViewportSize({width:390,height:844});
  await page.goto('/calendar-reminders/'); await expect(page.locator('.cal-day')).toHaveCount(42);
  await page.locator('[data-preset="practice"]').click();
  for (const start of [0, 100, 600]) {
    await page.locator('#tab-selection').click(); await page.evaluate(y => scrollTo(0, y), start);
    for (const tab of ['preview', 'selection', 'preview', 'selection']) {
      const [before, after] = await page.evaluate(async name => {
        const bar = document.querySelector('.mobile-tabs'), before = bar.getBoundingClientRect().top;
        document.querySelector(`#tab-${name}`).click();
        await new Promise(resolve => requestAnimationFrame(resolve));
        return [Math.round(before), Math.round(bar.getBoundingClientRect().top)];
      }, tab);
      expect(after, `start ${start}, tap ${tab}`).toBe(before);
    }
  }
});
