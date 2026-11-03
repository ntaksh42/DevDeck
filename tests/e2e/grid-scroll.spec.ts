import { expect, test, type Locator } from "@playwright/test";

async function expectRowsCoverViewportBeforePaint(grid: Locator) {
  await expect(grid.locator('[role="row"]').first()).toBeVisible();
  const result = await grid.evaluate(async (element) => {
    const firstRow = element.querySelector<HTMLElement>('[role="row"]')!;
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
