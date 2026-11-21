import { expect, test, type Locator, type Page } from "@playwright/test";

async function expectRowsCoverViewportBeforePaint(grid: Locator) {
  await expect(grid.locator('[role="row"][aria-selected]').first()).toBeVisible();
  const result = await grid.evaluate(async (element) => {
    const firstRow = element.querySelector<HTMLElement>('[role="row"][aria-selected]')!;
    const body = firstRow.parentElement!;
    let ancestor: HTMLElement | null = firstRow.parentElement;
    while (ancestor && !/auto|scroll/.test(getComputedStyle(ancestor).overflowY)) {
      ancestor = ancestor.parentElement;
    }
    const scroller = ancestor!;
    const height = scroller.scrollHeight;
    const header = body.getBoundingClientRect().top + scroller.scrollTop
      - scroller.getBoundingClientRect().top;
    const gaps: { top: number; bottom: number; scrollTop: number }[] = [];
    let samples = 0;
    const measure = () => {
      const rows = Array.from(body.children).filter((node) =>
        node.matches('[role="row"], button[aria-expanded]'),
      );
      const bounds = scroller.getBoundingClientRect();
      const top = rows[0].getBoundingClientRect().top
        - bounds.top - Math.max(0, header - scroller.scrollTop);
      const bottom = bounds.top + scroller.clientHeight
        - rows[rows.length - 1].getBoundingClientRect().bottom;
      samples++;
      if (top > 1 || bottom > 1) gaps.push({ top, bottom, scrollTop: scroller.scrollTop });
    };
    const onScroll = () => requestAnimationFrame(measure);
    scroller.addEventListener("scroll", onScroll);
    const frame = () => new Promise(requestAnimationFrame);
    const max = height - scroller.clientHeight;
    try {
      // Include small movements, large wheel bursts, scrollbar-sized jumps,
      // and reversals. Sample inside rAF, before React can catch up later.
      for (const top of [120, 240, 360, 960, 1560, max, max - 600, 600, 0, max, 0]) {
        scroller.scrollTop = Math.max(0, top);
        await frame();
        await frame();
      }
      return { gaps, samples, height, finalHeight: scroller.scrollHeight };
    } finally {
      scroller.removeEventListener("scroll", onScroll);
    }
  });
  expect(result.samples).toBeGreaterThan(5);
  expect(result.gaps).toEqual([]);
  expect(result.finalHeight).toBe(result.height);
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto("/?scenario=large-data&wiCount=3000");
});

test("Work items cover fast scrolls before paint", async ({ page }) => {
  await page.locator("nav").getByRole("button", { name: /^My Items/ }).click();
  await expectRowsCoverViewportBeforePaint(page.getByRole("grid", { name: "Work items" }));
});

test("My Reviews covers fast scrolls before paint", async ({ page }) => {
  await expectRowsCoverViewportBeforePaint(page.getByRole("grid", { name: "My review pull requests" }));
});

test("PR search covers fast scrolls before paint", async ({ page }) => {
  await page.locator("nav").getByRole("button", { name: /^Search$/ }).first().click();
  await page.getByRole("main").getByRole("button", { name: "Search", exact: true }).click();
  await expectRowsCoverViewportBeforePaint(page.getByRole("grid", { name: "Pull request search results" }));
});

// Scrolling up fast from the bottom unmounts the focused row in the same commit
// that swaps the window. The scroll height must not dip during that commit, or
// Chromium clamps the position and the grid lands rows above where it should
// (and short of the bottom once scrolled back).
async function expectExactWheelFromBottom(page: Page, firstRow: string) {
  const row = page.locator(firstRow).first();
  await row.click();
  const box = (await row.boundingBox())!;
  await page.mouse.move(box.x + 300, box.y + 60);
  const position = () =>
    page.evaluate((selector) => {
      let scroller = document.querySelector<HTMLElement>(selector)!.parentElement;
      while (scroller && !/auto|scroll/.test(getComputedStyle(scroller).overflowY)) {
        scroller = scroller.parentElement;
      }
      return { top: Math.round(scroller!.scrollTop), max: scroller!.scrollHeight - scroller!.clientHeight };
    }, firstRow);
  await page.mouse.wheel(0, 1e6);
  await expect.poll(async () => { const { top, max } = await position(); return max - top; }).toBe(0);
  await page.locator(firstRow).last().click();
  const bottom = (await position()).top;
  expect(bottom).toBeGreaterThan(900);
  await page.mouse.wheel(0, -900);
  await expect.poll(async () => (await position()).top).toBe(bottom - 900);
  await page.waitForTimeout(200);
  expect((await position()).top).toBe(bottom - 900);
  await page.mouse.wheel(0, 900);
  await expect.poll(async () => (await position()).top).toBe(bottom);
}

test.describe("fast wheel from the bottom with a focused row", () => {
  // Hundreds of rows per grid: allow for slow, heavily parallel CI runners.
  test.describe.configure({ timeout: 60_000 });
  test.beforeEach(async ({ page }) => {
    await page.goto("/?scenario=large-data");
  });

  test("Work items", async ({ page }) => {
    await page.locator("nav").getByRole("button", { name: /^My Items/ }).click();
    await expectExactWheelFromBottom(page, '[aria-label="Work items"] [role="row"][aria-selected]');
  });

  test("My Reviews", async ({ page }) => {
    await expectExactWheelFromBottom(page, '[aria-label="My review pull requests"] [role="row"][aria-selected]');
  });

  test("PR search", async ({ page }) => {
    await page.locator("nav").getByRole("button", { name: /^Search$/ }).first().click();
    await page.getByRole("main").getByRole("button", { name: "Search", exact: true }).click();
    await expectExactWheelFromBottom(page, '[aria-label="Pull request search results"] [role="row"][aria-selected]');
  });

  test("Notifications", async ({ page }) => {
    await page.locator("nav").getByRole("button", { name: /^Notifications/ }).click();
    await expectExactWheelFromBottom(page, '[aria-label="Notifications"] [role="row"]');
  });

  test("Inbox", async ({ page }) => {
    await page.locator("nav").getByRole("button", { name: /^Inbox/ }).click();
    await expectExactWheelFromBottom(page, '[id^="inbox-row-"]');
  });
});
