import {test, expect} from '@playwright/test';
import {showMoreSettings, openZonePicker} from './more-settings.mjs';

const path = '/calendar-reminders/';
const draft = page => page.evaluate(() => JSON.parse(localStorage.getItem('huideng.calendar.v2')));
const frames = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const runningFeedback = page => page.evaluate(() => document.getAnimations().filter(animation => animation.id.startsWith('calendar-') && animation.playState === 'running').length);

async function open(page, {reducedMotion = 'no-preference', missingAnimationAPI = false} = {}) {
  const errors = [], writes = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/subscriptions**', async route => {
    if (['POST', 'PATCH', 'DELETE'].includes(route.request().method())) {
      writes.push(route.request().method());
      return route.abort();
    }
    return route.continue();
  });
  await page.emulateMedia({reducedMotion});
  await page.setViewportSize({width: 1440, height: 1000});
  await page.addInitScript(({missingAnimationAPI}) => {
    window.motionCalls = [];
    window.motionAnimations = [];
    if (missingAnimationAPI) {
      Object.defineProperty(Element.prototype, 'animate', {configurable: true, value: undefined});
      return;
    }
    const animate = Element.prototype.animate;
    Element.prototype.animate = function (...args) {
      window.motionCalls.push({classes: String(this.className), id: this.id});
      const animation = animate.apply(this, args);
      window.motionAnimations.push(animation);
      return animation;
    };
  }, {missingAnimationAPI});
  await page.goto(path+(path.includes('#')||path.includes('?')?'':'#subscribe'));
  await expect(page.locator('#app')).toBeVisible();
  await showMoreSettings(page);
  await expect(page.locator('#preview-error')).toBeHidden();
  return {errors, writes};
}

test('published motion stylesheet loads as CSS and drives dialog feedback with a reduced-motion fallback', async ({page}) => {
  const response = page.waitForResponse(r => new URL(r.url()).pathname.endsWith('/motion.css'));
  const audit = await open(page);
  const css = await response;
  expect(css.status()).toBe(200);
  expect(css.headers()['content-type']).toContain('text/css');
  // The stylesheet is applied, not just fetched. (Panels are flat since the 11-10 redesign, so a shadow is no longer the probe.)
  expect(await page.evaluate(() => [...document.styleSheets].some(sheet => sheet.href?.endsWith('/motion.css') && sheet.cssRules.length > 0))).toBe(true);
  await page.locator('[data-preset="guru"]').click();
  await page.locator('#reminder-settings').click();
  const dialog = page.locator('#reminder-dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveCSS('animation-name','calendar-dialog-in');
  await page.emulateMedia({reducedMotion:'reduce'});
  await expect(dialog).toHaveCSS('animation-name','none');
  expect(audit).toEqual({errors:[],writes:[]});
});

test('rapid preset and month changes finish on the last choice with usable keyboard focus', async ({page}) => {
  const audit = await open(page);
  await page.locator('#include-daily-dates').check();
  await page.evaluate(() => {
    for (const name of ['practice', 'guru', 'tsok', 'practice', 'guru']) {
      document.querySelector(`[data-preset="${name}"]`).click();
    }
  });
  await expect(page.locator('[data-preset="guru"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-preset="guru"]')).toBeFocused();
  await expect(page.locator('[data-event]:checked')).toHaveCount(1);
  await expect(page.locator('#include-daily-dates')).toBeChecked();
  const initial = await page.locator('[data-cal-month]').inputValue();
  const [year, month] = initial.split('-').map(Number);
  const expected = new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 7);
  await page.evaluate(() => {
    for (const direction of ['next', 'next', 'previous']) {
      const button = document.querySelector(`[data-cal-action="${direction}"]`);
      button.focus({preventScroll: true});
      button.click();
    }
  });
  await expect(page.locator('[data-cal-month]')).toHaveValue(expected);
  await expect(page.locator('[data-cal-action="previous"]')).toBeFocused();
  await expect(page.locator('.cal-day')).toHaveCount(42);
  await expect.poll(() => runningFeedback(page)).toBe(0);
  await page.locator('.cal-day[tabindex="0"]').focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('.cal-day[tabindex="0"]')).toBeFocused();
  expect((await draft(page)).includeDailyDates).toBe(true);
  expect(audit).toEqual({errors: [], writes: []});
});

test('reduced motion skips feedback from load and cancels an in-flight effect when enabled', async ({page}) => {
  const audit = await open(page, {reducedMotion: 'reduce'});
  await page.locator('[data-preset="tsok"]').click();
  await page.locator('[data-cal-action="next"]').click();
  await page.locator('[data-group-id="masters"] > summary').click();
  // Safari does not focus buttons on pointer click; use a real keyboard entry
  // so restoring focus after Escape has the same meaning in all engines.
  // (The time-zone window: it opens without saving anything.)
  await showMoreSettings(page);
  await page.locator('#zone-settings-inline').focus();
  await page.locator('#zone-settings-inline').press('Enter');
  await expect(page.locator('#zone-dialog')).toBeVisible();
  expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);
  expect(await page.evaluate(() => window.motionCalls.length)).toBe(0);
  await page.keyboard.press('Escape');
  await expect(page.locator('#zone-settings-inline')).toBeFocused();
  await page.emulateMedia({reducedMotion: 'no-preference'});
  await expect.poll(() => page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(false);
  // Stretch only the feedback lifetime so the media-change assertion proves
  // cancellation rather than accidentally waiting for a 200ms effect to finish.
  const active = await page.evaluate(() => {
    window.motionAnimations = [];
    document.querySelector('[data-cal-action="next"]').click();
    const animations = window.motionAnimations.filter(animation => animation.id.startsWith('calendar-'));
    for (const animation of animations) animation.effect.updateTiming({duration: 10000});
    return animations.length;
  });
  expect(active).toBeGreaterThan(0);
  await frames(page);
  await expect.poll(() => page.evaluate(() => window.motionAnimations.filter(animation => animation.playState === 'running').length)).toBe(active);
  await page.emulateMedia({reducedMotion: 'reduce'});
  await expect.poll(() => page.evaluate(() => window.motionAnimations.every(animation => animation.playState === 'idle'))).toBe(true);
  await expect(page.locator('.cal-day')).toHaveCount(42);
  expect(audit).toEqual({errors: [], writes: []});
});

test('missing animation API keeps selection, disclosure, month navigation and dialogs usable', async ({page}) => {
  const audit = await open(page, {missingAnimationAPI: true});
  await page.locator('[data-preset="practice"]').click();
  await expect(page.locator('#selection-count')).toHaveText('已选 54 项');
  await expect(page.locator('#reminder-count')).toHaveText('2 项提醒');
  await page.locator('#include-daily-dates').check();
  const group = page.locator('[data-group-id="masters"]');
  await group.locator('summary').click();
  await expect(group).toHaveAttribute('open', '');
  const before = await page.locator('[data-cal-month]').inputValue();
  await page.locator('[data-cal-action="next"]').click();
  await expect(page.locator('[data-cal-month]')).not.toHaveValue(before);
  await page.locator('#reminder-settings').click();
  await expect(page.locator('#reminder-dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#reminder-settings')).toBeFocused();
  await page.locator('#clear-selection').click();
  await expect(page.locator('#include-daily-dates')).not.toBeChecked();
  await expect(page.locator('#subscribe')).toBeDisabled();
  expect(audit).toEqual({errors: [], writes: []});
});

test('restored open categories do not replay expansion and daily dates retain the shared paper styling', async ({page}) => {
  const audit = await open(page);
  await page.locator('[data-preset="guru"]').click();
  const group = page.locator('[data-group-id="masters"]');
  await group.locator('summary').click();
  await frames(page);
  expect(await page.evaluate(() => window.motionCalls.some(call => call.classes.includes('event-list')))).toBe(true);
  const palette = () => page.locator('.daily-date-option').evaluate(node => ({
    background: getComputedStyle(node).backgroundColor,
    color: getComputedStyle(node.querySelector('#daily-date-title')).color,
    paper: getComputedStyle(node.closest('.quick-panel')).backgroundColor
  }));
  const initialPalette = await palette();
  await page.evaluate(() => { window.motionCalls = []; });
  await group.locator('[data-event]').first().check();
  await expect(group).toHaveAttribute('open', '');
  await frames(page);
  expect(await page.evaluate(() => window.motionCalls.filter(call => /event-list|group-tools/.test(call.classes)))).toEqual([]);
  await page.locator('#include-daily-dates').check();
  await expect(page.locator('#daily-date-count')).toBeVisible();
  // Chosen, it wears the 边玛 band like a chosen plan (11-12); unchosen, it is
  // back to the shared paper.
  await expect.poll(() => page.locator('.daily-date-option').evaluate(node => getComputedStyle(node, '::before').transform)).toMatch(/^(none|matrix\(1, 0, 0, 1, 0, 0\))$/);
  await page.locator('#include-daily-dates').uncheck();
  await expect.poll(palette).toEqual(initialPalette);
  await expect(page.locator('#event-guru-tsok')).toBeChecked();
  expect(audit).toEqual({errors: [], writes: []});
});

test('a chosen preset toggles off with undo and keeps keyboard focus on the plan', async ({page}) => {
  const audit = await open(page);
  await page.locator('[data-preset="guru"]').click();
  await expect.poll(() => runningFeedback(page)).toBe(0);
  const before = await draft(page);
  // Tapping the chosen plan again cancels it (like the checkbox below); undo
  // brings back exactly the same plan.
  await page.locator('[data-preset="guru"]').click();
  await expect(page.locator('[data-preset="guru"]')).toHaveAttribute('aria-pressed','false');
  await expect(page.locator('#selection-count')).toHaveText('已选 0 项');
  await page.locator('#toast .toast-undo').click();
  await expect(page.locator('[data-preset="guru"]')).toHaveAttribute('aria-pressed','true');
  expect(await draft(page)).toEqual(before);
  await page.locator('[data-preset="guru"]').focus();
  await expect(page.locator('[data-preset="guru"]')).toBeFocused();

  expect(audit).toEqual({errors: [], writes: []});
});
