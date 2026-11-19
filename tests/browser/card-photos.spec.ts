import { expect, test, type Locator, type Page } from '@playwright/test';
import { seedFormation } from './formation-seed';

// Validate each rendered image and any initials fallback in the actual card frames.
async function checkFrames(frames: Locator) {
  await expect(frames.first()).toBeVisible();
  for (const frame of await frames.all()) {
    const photo = frame.locator('.gd-photo');
    const img = photo.locator('img');
    const initials = photo.locator('.gd-photo-fallback');
    await frame.scrollIntoViewIfNeeded();
    if (await initials.count()) {
      await expect(img).toHaveCount(0);
      const box = await initials.boundingBox(), bounds = await photo.boundingBox();
      expect(box).not.toBeNull(); expect(bounds).not.toBeNull();
      expect(Math.abs(box!.x + box!.width / 2 - bounds!.x - bounds!.width / 2)).toBeLessThanOrEqual(2);
      expect(Math.abs(box!.y + box!.height / 2 - bounds!.y - bounds!.height / 2)).toBeLessThanOrEqual(2);

    } else {
      await expect(img).toHaveCount(1);
      await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0);
      const box = await img.boundingBox(), bounds = await img.locator("xpath=ancestor::*[contains(@class,'gd-photo')][1]").boundingBox();
      expect(box).not.toBeNull(); expect(bounds).not.toBeNull();
      expect(box!.height).toBeLessThanOrEqual(bounds!.height + 1);
      expect(Math.abs(box!.y + box!.height - bounds!.y - bounds!.height)).toBeLessThanOrEqual(2);
      expect(box!.y - bounds!.y).toBeGreaterThanOrEqual(4);
      expect(await img.evaluate(el => getComputedStyle(el).objectFit)).toBe('contain');
      expect(await img.evaluate(el => getComputedStyle(el).objectPosition)).toContain('100%');
    }
  }
}

// Seed deterministic image geometry without relying on ESPN's CDN.
async function setup(page: Page) {
  await page.route('https://a.espncdn.com/i/headshots/nfl/players/full/**', route => route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="600" height="436"><rect width="600" height="436" fill="#14342b"/></svg>'}));
  await seedFormation(page, {}, {gemPool:'All',gemPos:'All',gemFilterVersion:'4',gemSignals:'[]',scoutingView:'cards'});
}
for (const width of [1320, 390]) {
  test(`card photo framing at ${width}px`, async ({page}) => {
    await page.setViewportSize({width,height:900});
    await setup(page);
    await checkFrames(page.locator('.gd-fc-portrait:visible'));
    await page.goto('./#/scouting');
    await expect(page.locator('.gd-pcard-photo:visible').first()).toBeVisible();
    await checkFrames(page.locator('.gd-pcard-photo:visible'));
    const first = page.locator('.gd-pcard:visible').first();
    const second = page.locator('.gd-pcard:visible').nth(1);
    await first.getByRole('button', {name:/Add .* to versus/}).click();
    await second.getByRole('button', {name:/Add .* to versus/}).click();
    await expect(page.getByRole('dialog',{name:'Versus'})).toBeVisible();
    await checkFrames(page.locator('.gd-versus-photo:visible'));
    await page.getByLabel('Change left player').fill('Summit Hawks \u00b7 D/ST \u00b7 MNE');
    await expect(page.locator('.gd-versus-photo:visible .gd-photo-fallback')).toHaveCount(1);
    await checkFrames(page.locator('.gd-versus-photo:visible'));
    await page.keyboard.press('Escape');
    await page.goto('./#/teams');
    await page.getByRole('button',{name:/Test A QB grade/i}).click();
    await checkFrames(page.locator('.gd-tile-photo:visible'));
    await page.keyboard.press('Escape');
    await page.getByRole('button',{name:/Test A D\/ST grade/i}).click();
    await checkFrames(page.locator('.gd-tile-photo:visible'));
    await page.keyboard.press('Escape');
  });
}




// Cover move-card photos and initials with isolated synthetic trade drafts.
for (const width of [1320, 390]) {
  test(`move-card photo and initials framing at ${width}px`, async ({ page }) => {
    test.setTimeout(180000);
    await page.setViewportSize({ width, height: 900 });
    await page.route("https://a.espncdn.com/i/headshots/nfl/players/full/**", route => route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="436"><rect width="600" height="436" fill="#14342b"/></svg>' }));
    for (const draft of [{ give: "1", get: "500" }, { give: "2", get: "502" }, { give: "4", get: "504" }, { give: "9", get: "510" }]) {
      await seedFormation(page);
      await page.evaluate(async (selection) => {
        const db = await new Promise<IDBDatabase>((resolve, reject) => { const r = indexedDB.open("fantasy-football-lab", 1); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction("current", "readwrite"), store = tx.objectStore("current"), request = store.get("local");
          request.onsuccess = () => { const workspace = request.result; workspace.state.draft = { teamA: "1", teamB: "2", give: [selection.give], get: [selection.get] }; store.put(workspace, "local"); };
          tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error);
        });
        db.close();
      }, draft);
      await page.goto("./#/week"); await page.reload();
      const frame = page.locator(".gd-move-trade:visible .gd-move-photo");
      await checkFrames(frame);
      if (draft.get === "510") await expect(frame.locator(".gd-photo-fallback")).toHaveCount(1);
    }
  });
}
