// 更多设置 sits before step 3 and starts folded on every screen (11-11).
// Tests that work with categories, title marks or the region open it the way
// a person does: one tap on its summary. On phones the tests that open a page
// keep it folded (phones are checked folded), and an open dialog is left alone.
export async function showMoreSettings(page, {computerOnly = false} = {}) {
  if (computerOnly && (page.viewportSize()?.width ?? 1280) < 1024) return;
  if (await page.locator('dialog[open]').count()) return;
  const details = page.locator('#advanced-settings');
  if (!await details.evaluate(node => node.open)) await details.locator(':scope>summary').click();
}
export async function openZonePicker(page) {
  await showMoreSettings(page);
  await page.locator('#zone-settings-inline').click();
}
