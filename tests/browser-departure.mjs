// Complete the new departure choice while keeping historical run checks intact.
export async function confirmDeparture(page) {
  if (await page.locator('#journey-dialog').isVisible()) await page.locator('#journey-dialog [data-action="classic"]').click();
  if (await page.locator('#walk-picker').isVisible()) await page.locator('#walk-picker-start').click();
}
