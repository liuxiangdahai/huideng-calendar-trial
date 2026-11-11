import {test, expect} from '@playwright/test';

// 11-10: reading the month. Dates fixed by the bundled 藏历 PRO data:
// 2026-10-28 skips 九月十七, 2026-11-30 skips 十月廿一, 2026-12-11/12 are both
// 十一月初三, and 2026-11-10 is 十月初一.
async function open(page, width, preset = 'practice') {
  await page.setViewportSize({width, height: 900});
  await page.goto('/calendar-reminders/');
  await expect(page.locator('.cal-day')).toHaveCount(42);
  await page.locator(`[data-preset="${preset}"]`).click();
  if (width < 1024) await page.locator('#tab-preview').click();
  await page.locator('[data-cal-month]').selectOption('2026-11');
}

async function expectBeside(page, day) {
  const [card, date, grid] = await Promise.all([page.locator('[data-cal-sheet]').boundingBox(),
    page.locator(`[data-cal-date="${day}"]`).boundingBox(), page.locator('.cal-grid').boundingBox()]);
  const overlap = Math.max(0, Math.min(card.x + card.width, date.x + date.width) - Math.max(card.x, date.x))
    * Math.max(0, Math.min(card.y + card.height, date.y + date.height) - Math.max(card.y, date.y));
  expect(overlap, `card covers ${day}`).toBe(0);
  expect(card.x).toBeGreaterThanOrEqual(grid.x - 1);
  expect(card.x + card.width).toBeLessThanOrEqual(grid.x + grid.width + 1);
  expect(card.y + card.height).toBeLessThanOrEqual(grid.y + grid.height + 1);
}

test('computers open the day as a card beside the date, keep the keyboard on the grid, and close it on Esc or outside', async ({page}) => {
  await open(page, 1366);
  const sheet = page.locator('[data-cal-sheet]');
  await expect(sheet).toBeHidden();
  const cell = page.locator('[data-cal-date="2026-11-19"]');
  await cell.click();
  await expect(sheet).toBeVisible();
  await expect(sheet).toContainText('2026年11月19日');
  await expect(sheet).toContainText('莲师荟供日');
  // Beside the date, level with it, never covering it, inside the calendar.
  await expectBeside(page, '2026-11-19');
  // Focus stays on the date: the arrow keys keep walking the month and Enter moves the card.
  await expect(page.locator(':focus')).toHaveAttribute('data-cal-date', '2026-11-19');
  await page.keyboard.press('ArrowRight'); await page.keyboard.press('Enter');
  await expect(sheet).toContainText('2026年11月20日');
  // A visible date moves it; Esc and a click outside close it.
  await page.locator('[data-cal-date="2026-11-22"]').click();
  await expect(sheet).toContainText('2026年11月22日');
  await page.keyboard.press('Escape');
  await page.locator('[data-cal-date="2026-11-24"]').click();
  await expect(sheet).toContainText('阿弥陀佛加持日');
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();
  await page.locator('[data-cal-date="2026-11-24"]').click();
  await expect(sheet).toBeVisible();
  await page.locator('.cal-key-note').click();
  await expect(sheet).toBeHidden();
  // The phone list is not shown on a computer.
  await expect(page.locator('[data-cal-month-list]')).toBeHidden();
});

for (const width of [1024, 1366, 1920]) test(`the card never covers its date in any column at ${width}px`, async ({page}) => {
  await open(page, width);
  for (const day of ['2026-11-02', '2026-11-04', '2026-11-05', '2026-11-08', '2026-11-19', '2026-11-29', '2026-12-03']) {
    await page.locator('[data-cal-month]').selectOption('2026-11');
    await page.locator(`[data-cal-date="${day}"]`).click();
    await page.locator('[data-cal-month]').selectOption(day.slice(0, 7)).catch(() => {});
    if (day.slice(0, 7) !== '2026-11') await page.locator(`[data-cal-date="${day}"]`).click();
    await expect(page.locator('[data-cal-sheet]')).toBeVisible();
    await expectBeside(page, day);
    await page.keyboard.press('Escape');
  }
});

test('a card near the bottom of the grid opens upward and stays over the calendar', async ({page}) => {
  await open(page, 1366);
  await page.locator('[data-cal-date="2026-12-03"]').click();
  await expect(page.locator('[data-cal-month]')).toHaveValue('2026-12');
  await page.locator('[data-cal-month]').selectOption('2026-11');
  const cell = page.locator('[data-cal-date="2026-11-29"]');
  await cell.click();
  const [card, grid] = await Promise.all([page.locator('[data-cal-sheet]').boundingBox(), page.locator('.cal-grid').boundingBox()]);
  expect(card.y + card.height).toBeLessThanOrEqual(grid.y + grid.height + 1);
});

for (const width of [390, 820]) test(`phones and tablets list the month's days by name under the grid at ${width}px`, async ({page}) => {
  await open(page, width);
  const list = page.locator('[data-cal-month-list]');
  await expect(list).toBeVisible();
  await expect(list.locator('.cal-month-list-title')).toContainText('11月已选的日子');
  // Every tinted day has its row, and only those: days not chosen stay out once something is chosen.
  const chosen = await page.locator('.cal-day:not(.cal-adjacent):is(.has-remind, .has-display)').count();
  await expect(list.locator('.cal-month-row')).toHaveCount(chosen);
  await expect(list.locator('.cal-month-list-title')).toContainText(`${chosen} 天`);
  await expect(list.locator('.is-spare')).toHaveCount(0);
  const tsok = list.locator('[data-cal-pick="2026-11-19"]');
  await expect(tsok).toContainText('莲师荟供日');
  await expect(tsok).toContainText('十月初十');
  await expect(tsok.locator('.cal-month-row-bell')).toHaveCount(1);
  await expect(list.locator('[data-cal-pick="2026-11-24"] .cal-month-row-bell')).toHaveCount(0);
  await tsok.click();
  const sheet = page.locator('[data-cal-sheet]');
  await expect(sheet).toBeVisible();
  await expect(sheet).toContainText('2026年11月19日');
  // The tap hint is a computer thing; the list replaces it here.
  await expect(page.locator('.cal-legend-tap')).toBeHidden();
});

for (const width of [390, 1366]) test(`cells say where a Tibetan day is skipped or repeated, and where a month begins, at ${width}px`, async ({page}) => {
  await open(page, width);
  await expect(page.locator('[data-cal-date="2026-11-30"] .cal-miss')).toHaveText('缺廿一');
  await expect(page.locator('[data-cal-date="2026-10-28"] .cal-miss')).toHaveText('缺十七');
  await expect(page.locator('[data-cal-date="2026-11-30"] .cal-miss')).toBeVisible();
  await expect(page.locator('[data-cal-date="2026-11-30"]')).toHaveAttribute('aria-label', /缺日：藏历火马年十月廿一/);
  await expect(page.locator('[data-cal-date="2026-11-10"] .cal-tibetan')).toHaveText('十月');
  await expect(page.locator('[data-cal-date="2026-11-11"] .cal-tibetan')).toHaveText('初二');
  await page.locator('[data-cal-month]').selectOption('2026-12');
  for (const date of ['2026-12-11', '2026-12-12']) {
    await expect(page.locator(`[data-cal-date="${date}"] .cal-repeat`)).toHaveText('重日');
    await expect(page.locator(`[data-cal-date="${date}"] .cal-tibetan`)).toHaveText('初三');
  }
});

test('with daily dates on, cells keep the short label instead of repeating 藏历', async ({page}) => {
  await open(page, 1366);
  await page.locator('#include-daily-dates').check({force: true});
  await expect(page.locator('.cal-daily-line')).toHaveCount(0);
  expect(await page.locator('.cal-grid').innerText()).not.toContain('藏历');
  await expect(page.locator('[data-cal-date="2026-11-12"] .cal-tibetan')).toHaveText('初三');
  await expect(page.locator('.cal-legend-daily')).toHaveText('每天的藏历日期也会出现在你的日历里');
  await expect(page.locator('body')).not.toContainText('日期全天显示');
});

test('the month head controls never overlap, from phone to wide desktop', async ({page}) => {
  for (const width of [390, 820, 1024, 1180, 1366]) {
    await page.setViewportSize({width, height: 900});
    await page.goto('/calendar-reminders/');
    await expect(page.locator('.cal-day')).toHaveCount(42);
    if (width < 1024) await page.locator('#tab-preview').click();
    const boxes = await page.evaluate(() => ['[data-cal-action="previous"]', '.cal-month-picker', '[data-cal-action="next"]', '.cal-today', '.cal-month-context', '.cal-view-switch']
      .map(selector => [selector, document.querySelector(selector).getBoundingClientRect().toJSON()]));
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
      const [[na, a], [nb, b]] = [boxes[i], boxes[j]];
      const overlap = a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1;
      expect(overlap, `${width}px: ${na} overlaps ${nb}`).toBe(false);
    }
  }
});

// 11-11: a first visit is never an empty month. Computers show days not
// chosen as grey names; phones keep the grid clean and, until something is
// chosen, list the month's days in grey under it. Once chosen, a day is tinted.
for (const width of [390, 1366]) test(`days not chosen show in grey until chosen at ${width}px`, async ({page}) => {
  await page.setViewportSize({width, height: 900});
  await page.goto('/calendar-reminders/');
  await expect(page.locator('.cal-day')).toHaveCount(42);
  if (width < 1024) await page.locator('#tab-preview').click();
  await page.locator('[data-cal-month]').selectOption('2026-11');
  const day = page.locator('[data-cal-date="2026-11-19"]');
  await expect(day).toHaveAttribute('aria-label', /0项已选日程，未选：莲师荟供日/);
  if (width < 1024) {
    await expect(day).not.toHaveClass(/has-remind|has-display/);
    await expect(page.locator('.cal-key .cal-legend-item.is-spare')).toBeHidden();
    const list = page.locator('[data-cal-month-list]');
    await expect(list.locator('.cal-month-list-title')).toContainText('11月的修行日还没有选');
    await expect(list.locator('[data-cal-pick="2026-11-19"] .is-spare')).toHaveText('莲师荟供日');
  } else {
    await expect(page.locator('.cal-key .cal-legend-item.is-spare')).toHaveText('未选');
    await expect(day.locator('.cal-mini-event.is-spare')).toHaveText('莲师荟供日');
  }
  await day.click();
  const sheet = page.locator('[data-cal-sheet]');
  await expect(sheet.locator('.cal-spare')).toContainText('这天有未选');
  await expect(sheet.locator('.cal-spare')).toContainText('莲师荟供日');
  await expect(sheet.locator('.cal-reminder')).toHaveCount(0);
  // Choosing it turns the grey day into a chosen one.
  await page.keyboard.press('Escape');
  if (width < 1024) await page.locator('#tab-selection').click();
  await page.locator('[data-preset="guru"]').click();
  if (width < 1024) {
    await page.locator('#tab-preview').click();
    await expect(day).toHaveClass(/has-remind/);
    await expect(page.locator('[data-cal-month-list] .cal-month-list-title')).toContainText('11月已选的日子');
  }
  await expect(day).toHaveAttribute('aria-label', /1项已选日程，莲师荟供日/);
  await expect(day.locator('.is-spare')).toHaveCount(0);
});
