import { chromium, type FullConfig } from "@playwright/test";

/**
 * Loads the app once before the workers start. On a cold dev server the first
 * page load compiles every module, and parallel workers all waiting on it at
 * once overran the 5 s expectations of whichever tests happened to start first.
 */
export default async function globalSetup(config: FullConfig) {
  const baseURL = config.projects[0]?.use.baseURL;
  if (!baseURL) return;
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(baseURL);
    await page
      .getByRole("grid", { name: "My review pull requests" })
      .waitFor({ state: "visible", timeout: 120_000 });
  } finally {
    await browser.close();
  }
}
