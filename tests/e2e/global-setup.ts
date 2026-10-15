import { readFileSync } from "node:fs";
import { chromium, type FullConfig } from "@playwright/test";

/**
 * Loads the app and every lazily loaded view once before the workers start.
 * On a cold dev server the first request for a module compiles it, and
 * parallel workers waiting on that at the same time (the start page, or a
 * view's chunk on its first visit) overran the 5 s expectations of whichever
 * tests got there first.
 */
export default async function globalSetup(config: FullConfig) {
  const baseURL = config.projects[0]?.use.baseURL;
  if (!baseURL) return;
  const views = [
    ...readFileSync("src/app/lazyViews.ts", "utf8").matchAll(/import\("@\/([^"]+)"\)/g),
  ].map((match) => `/src/${match[1]}.tsx`);
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(baseURL);
    await page
      .getByRole("grid", { name: "My review pull requests" })
      .waitFor({ state: "visible", timeout: 120_000 });
    await page.evaluate(async (urls) => {
      await Promise.all(urls.map((url) => import(/* @vite-ignore */ url)));
    }, views);
  } finally {
    await browser.close();
  }
}
