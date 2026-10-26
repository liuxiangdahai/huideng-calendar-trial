import {test, expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {addDays, defaults, dateInZone, rangeEnd, selectOccurrences} from '../../static/calendar-reminders/core.mjs';
import {applyPreset} from '../../static/calendar-reminders/presets.mjs';

test.use({timezoneId: 'America/New_York'});

const data = JSON.parse(readFileSync('static/calendar-reminders/calendar-data.json', 'utf8'));
const settings = applyPreset(defaults(data.catalog, 'Asia/Shanghai'), data.catalog, 'practice');
// Use the real browser/device date. Do not fake Date: the PRO engine checks its constructor.
const today = dateInZone(new Date(), 'America/New_York');
const occurrences = selectOccurrences(data, settings, {start: addDays(today, -90), end: rangeEnd(today, 24)})
  .sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title, 'zh'));
const byDay = Object.groupBy(occurrences, event => event.date);
const busy = Object.entries(byDay).filter(([, events]) => events.length >= 5 && events.every(event => event.preference.mode === 'display'))
  .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))[0];

async function openBusyDay(page, width) {
  expect(busy, '已确认资料中应有一个在当前滚动窗口内的五项日程日期').toBeTruthy();
  await page.setViewportSize({width, height: 1000});
  await page.addInitScript(value => localStorage.setItem('huideng.calendar.v2', JSON.stringify(value)), settings);
  await page.goto('/calendar-reminders/');
  await expect(page.locator('#app')).toBeVisible();
  await expect(page.locator('#preview-error')).toBeHidden();
  if (width < 1024) await page.locator('#tab-preview').click();
  await page.locator('[data-cal-month]').selectOption(busy[0].slice(0, 7));
  await page.locator(`[data-cal-date="${busy[0]}"]`).click();
  await expect(page.locator('.cal-day')).toHaveCount(42);
  return page.locator('[data-cal-detail]');
}

async function verifyCards(page, detail) {
  const titles = busy[1].map(event => event.title);
  await expect(detail.locator('.cal-event h4')).toHaveText(titles);
  await expect(detail.locator('.cal-event-icon .icon')).toHaveCount(titles.length);
  await expect(detail.locator('.cal-all-day')).toHaveText(titles.map(() => '全天'));
  await expect(detail.locator('.cal-edit')).toHaveText(titles.map(() => '调整提醒'));
  await expect(detail.locator('.cal-device-time')).toHaveCount(0);
  await expect(detail.locator('.cal-reminder>span:not(.cal-edit)')).toHaveText(titles.map(() => '仅显示，不提醒'));
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

async function verifyMonthHierarchy(page) {
  const tones = await page.evaluate(() => {
    const luminance = color => color.match(/[\d.]+/g).slice(0, 3)
      .map(value => Number(value) / 255)
      .map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4)
      .reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);
    const contrast = (a, b) => (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
    const inspect = selector => {
      const day = document.querySelector(selector);
      const foreground = getComputedStyle(day.querySelector('.cal-gregorian'));
      const text = luminance(foreground.color);
      const tibetan = luminance(getComputedStyle(day.querySelector('.cal-tibetan')).color);
      const background = luminance(getComputedStyle(day).backgroundColor);
      return {text, tibetan, background, weight: Number(foreground.fontWeight),
        contrast: contrast(text, background), tibetanContrast: contrast(tibetan, background)};
    };
    return {
      current: inspect('.cal-day:not(.cal-adjacent):not(.cal-selected):not(.cal-is-today):not(:hover)'),
      adjacent: inspect('.cal-day.cal-adjacent:not(.cal-selected):not(.cal-is-today):not(:hover)')
    };
  });
  // Outside-month days recede without becoming unreadable or acquiring a darker backing.
  expect(tones.current.text).toBeLessThan(tones.adjacent.text);
  expect(tones.current.tibetan).toBeLessThan(tones.adjacent.tibetan);
  expect(tones.current.weight).toBeGreaterThan(tones.adjacent.weight);
  expect(tones.adjacent.background).toBeGreaterThanOrEqual(tones.current.background);
  for (const tone of Object.values(tones)) {
    expect(tone.contrast).toBeGreaterThanOrEqual(4.5);
    expect(tone.tibetanContrast).toBeGreaterThanOrEqual(4.5);
  }
}

async function enableOneAndVerifyConversion(page, detail) {
  const event = busy[1][0];
  const card = detail.locator('.cal-event').filter({has: page.locator(`[data-cal-event="${event.eventId}"]`)});
  await card.locator('[data-cal-event]').click();
  await expect(page.locator('input[name="reminder-mode"][value="display"]')).toBeChecked();
  await page.locator('input[name="reminder-mode"][value="remind"]').check();
  await page.locator('#reminder-form button[type="submit"]').click();
  await expect(card.locator('h4')).toHaveText(event.title);
  await expect(card.locator('.cal-reminder>span:not(.cal-edit)')).toHaveText('当天 08:00');
  await expect(detail.locator('.cal-device-time')).toHaveCount(1);
  await expect(detail.locator('.cal-event h4')).toHaveText(busy[1].map(item => item.title));
  await expect(page.locator(`[data-cal-date="${busy[0]}"]`)).toHaveClass(/cal-selected/);

  // 08:00 Beijing is 00:00 UTC, converted independently with the browser's device zone.
  const expectedLocal = await page.evaluate(date => {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {timeZone: 'America/New_York',
      year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'})
      .formatToParts(new Date(`${date}T00:00:00Z`)).map(part => [part.type, part.value]));
    return `${parts.year}年${Number(parts.month)}月${Number(parts.day)}日 ${parts.hour}:${parts.minute}`;
  }, busy[0]);
  await expect(card.locator('.cal-device-time>span')).toHaveText(expectedLocal);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

test('desktop month shows at most two original titles and opens complete classified cards', async ({page}) => {
  const detail = await openBusyDay(page, 1440);
  const cell = page.locator(`[data-cal-date="${busy[0]}"]`);
  await expect(cell.locator('.cal-mini-event')).toHaveText(busy[1].slice(0, 2).map(event => event.title));
  await expect(cell.locator('.cal-mini-event').first()).toBeVisible();
  await expect(cell.locator('.cal-mobile-events')).toBeHidden();
  await expect(cell.locator('.cal-more-events')).toHaveText(`另有 ${busy[1].length - 2} 项`);
  expect(await page.locator('.cal-day').evaluateAll(cells => cells.every(cell => cell.querySelectorAll('.cal-mini-event').length <= 2))).toBe(true);
  const truncation = await cell.locator('.cal-mini-event').first().evaluate(element => ({
    overflow: getComputedStyle(element).overflow, ellipsis: getComputedStyle(element).textOverflow,
    title: element.title, text: element.textContent
  }));
  expect(truncation).toEqual({overflow: 'hidden', ellipsis: 'ellipsis', title: busy[1][0].title, text: busy[1][0].title});
  await verifyCards(page, detail);
  await verifyMonthHierarchy(page);
  await page.screenshot({path: '.calendar-preview/cards-final-desktop.png', fullPage: true});
  await enableOneAndVerifyConversion(page, detail);
  // Today remains identifiable after keyboard-selecting another date.
  await page.locator('[data-cal-action="today"]').click();
  const todayCell = page.locator('.cal-day[aria-current="date"]');
  const neighborKey = (await todayCell.getAttribute('data-cal-date')).endsWith('-01') ? 'ArrowRight' : 'ArrowLeft';
  await todayCell.focus();
  await todayCell.press(neighborKey);
  await page.keyboard.press('Enter');
  await expect(todayCell).not.toHaveClass(/cal-selected/);
  const indicator = await todayCell.locator('.cal-gregorian').evaluate(node => ({
    todayColor: getComputedStyle(node).backgroundColor,
    selectedColor: getComputedStyle(document.querySelector('.cal-selected .cal-gregorian')).backgroundColor,
    selectedBorder: getComputedStyle(document.querySelector('.cal-selected')).borderTopColor
  }));
  expect(indicator.todayColor).not.toBe('rgba(0, 0, 0, 0)');
  expect(indicator.todayColor).not.toBe(indicator.selectedColor);
  expect(indicator.selectedBorder).not.toBe('rgba(0, 0, 0, 0)');
  expect(indicator.selectedBorder).not.toBe(indicator.todayColor);
});

test('phone month shows a readable original event name and extra count at 390 and 320 pixels', async ({page}) => {
  const detail = await openBusyDay(page, 390);
  for (const width of [390, 320]) {
    await page.setViewportSize({width, height: 1000});
    const cell = page.locator(`[data-cal-date="${busy[0]}"]`);
    await expect(cell.locator('.cal-day-events')).toBeHidden();
    const summary = cell.locator('.cal-mobile-event');
    await expect(summary).toBeVisible();
    await expect(summary).toHaveText(busy[1][0].title);
    await expect(summary).toHaveAttribute('title', busy[1][0].title);
    await expect(cell.locator('.cal-mobile-more')).toHaveText(`另 ${busy[1].length - 1} 项`);
    const summaryStyle = await summary.evaluate(node => ({fontSize: parseFloat(getComputedStyle(node).fontSize),
      lineClamp: getComputedStyle(node).webkitLineClamp, width: node.getBoundingClientRect().width,
      cellWidth: node.closest('.cal-day').getBoundingClientRect().width}));
    expect(summaryStyle.fontSize).toBeGreaterThanOrEqual(12);
    expect(summaryStyle.lineClamp).toBe('2');
    expect(summaryStyle.width).toBeLessThanOrEqual(summaryStyle.cellWidth);
    for (const event of busy[1]) await expect(cell).toHaveAttribute('aria-label', new RegExp(event.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    await verifyCards(page, detail);
    await verifyMonthHierarchy(page);
    expect(await detail.locator('.cal-event h4').evaluateAll(nodes => nodes.every(node => {
      const style = getComputedStyle(node);
      return style.whiteSpace !== 'nowrap' && style.overflowWrap === 'anywhere';
    }))).toBe(true);
    if (width === 390) await page.screenshot({path: '.calendar-preview/cards-final-mobile.png', fullPage: true});
  }
  await detail.locator('[data-cal-event]').first().click();
  await expect(page.locator('#reminder-dialog')).toBeVisible();
  await page.locator('[data-close="reminder-dialog"]').first().click();
  await expect(page.locator(`[data-cal-date="${busy[0]}"]`)).toHaveClass(/cal-selected/);
  await enableOneAndVerifyConversion(page, detail);
});
