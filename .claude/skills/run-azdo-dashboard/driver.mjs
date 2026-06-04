#!/usr/bin/env node
/**
 * Playwright driver for azdo-dashboard browser dev mode.
 *
 * Requires the dev server already running at http://127.0.0.1:1420.
 * Start it separately: pnpm dev --host 127.0.0.1 --port 1420
 *
 * Usage:
 *   node .claude/skills/run-azdo-dashboard/driver.mjs screenshot [path]
 *   node .claude/skills/run-azdo-dashboard/driver.mjs nav <route> [path]
 *   node .claude/skills/run-azdo-dashboard/driver.mjs smoke
 *   node .claude/skills/run-azdo-dashboard/driver.mjs custom <url> [path]
 *
 * Routes: home | prsearch | workitems | commits | settings
 * Screenshots default to os.tmpdir()/azdo-<route>.png
 */

import { chromium } from "@playwright/test";
import { tmpdir } from "os";
import { join } from "path";

const BASE_URL = "http://127.0.0.1:1420";

async function checkServer() {
  try {
    const res = await fetch(BASE_URL, { signal: AbortSignal.timeout(3000) });
    if (!res.ok && res.status >= 500) throw new Error(`HTTP ${res.status}`);
  } catch (e) {
    console.error(`Dev server not reachable at ${BASE_URL}.`);
    console.error("Start it first: pnpm dev --host 127.0.0.1 --port 1420");
    process.exit(1);
  }
}

async function withPage(fn) {
  const browser = await chromium.launch({ args: ["--no-sandbox", "--disable-gpu"] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  try {
    return await fn(page);
  } finally {
    await browser.close();
  }
}

const ROUTES = {
  home: async (page) => {
    await page.goto(BASE_URL);
    await page.waitForLoadState("networkidle");
  },
  prsearch: async (page) => {
    await page.goto(BASE_URL);
    await page.waitForLoadState("networkidle");
    await page.getByRole("complementary").first().getByRole("button", { name: "Search" }).first().click();
    await page.getByRole("main").getByRole("button", { name: "Search" }).click();
    await page.waitForTimeout(500);
  },
  workitems: async (page) => {
    await page.goto(BASE_URL);
    await page.waitForLoadState("networkidle");
    await page.getByRole("complementary").first().getByRole("button", { name: "Search" }).nth(1).click();
    const main = page.getByRole("main");
    await main.getByPlaceholder("Search work items…").fill("onboarding");
    await main.getByRole("button", { name: "Search" }).click();
    await page.waitForTimeout(500);
  },
  commits: async (page) => {
    await page.goto(BASE_URL);
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: "Commits" }).click();
    await page.waitForTimeout(300);
  },
  settings: async (page) => {
    await page.goto(BASE_URL);
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: "Settings" }).click();
    await page.waitForTimeout(300);
  },
};

const [, , cmd = "screenshot", ...rest] = process.argv;

(async () => {
  await checkServer();

  if (cmd === "screenshot") {
    const outPath = rest[0] ?? join(tmpdir(), "azdo-home.png");
    await withPage(async (page) => {
      await ROUTES.home(page);
      await page.screenshot({ path: outPath });
      console.log(`screenshot → ${outPath}`);
    });

  } else if (cmd === "nav") {
    const route = rest[0] ?? "home";
    const outPath = rest[1] ?? join(tmpdir(), `azdo-${route}.png`);
    const nav = ROUTES[route];
    if (!nav) {
      console.error(`Unknown route: ${route}. Available: ${Object.keys(ROUTES).join(", ")}`);
      process.exit(1);
    }
    await withPage(async (page) => {
      await nav(page);
      await page.screenshot({ path: outPath });
      console.log(`screenshot → ${outPath}`);
    });

  } else if (cmd === "smoke") {
    const results = [];
    await withPage(async (page) => {
      for (const [name, nav] of Object.entries(ROUTES)) {
        try {
          await nav(page);
          const heading = await page.getByRole("heading").first().textContent().catch(() => "?");
          const outPath = join(tmpdir(), `azdo-${name}.png`);
          await page.screenshot({ path: outPath });
          results.push({ name, heading: heading?.trim(), ok: true, screenshot: outPath });
        } catch (e) {
          results.push({ name, ok: false, error: e.message });
        }
      }
    });
    for (const r of results) {
      if (r.ok) console.log(`✓ ${r.name}: "${r.heading}" → ${r.screenshot}`);
      else console.error(`✗ ${r.name}: ${r.error}`);
    }
    if (results.some((r) => !r.ok)) process.exit(1);

  } else if (cmd === "custom") {
    const url = rest[0];
    const outPath = rest[1] ?? join(tmpdir(), "azdo-custom.png");
    if (!url) { console.error("Usage: driver.mjs custom <url> [path]"); process.exit(1); }
    await withPage(async (page) => {
      await page.goto(url);
      await page.waitForLoadState("networkidle");
      await page.screenshot({ path: outPath });
      console.log(`screenshot → ${outPath}`);
    });

  } else {
    console.error(`Unknown command: ${cmd}. Use: screenshot | nav | smoke | custom`);
    process.exit(1);
  }
})().catch((e) => { console.error(e.message); process.exit(1); });
