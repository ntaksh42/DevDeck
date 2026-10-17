import { expect, test } from "@playwright/test";

test("exports settings to a file without secrets and applies an imported file", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto("/");
  await expect(page.getByRole("grid", { name: "My review pull requests" })).toBeVisible();
  await page.evaluate(() => {
    window.localStorage.setItem("azdodeck:keybindings:v1", JSON.stringify({ toggleAgent: "Ctrl+L" }));
    window.localStorage.setItem("azdodeck:org:contoso:pat", "super-secret-token");
  });
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const backup = page.getByRole("heading", { name: "Backup" });
  await backup.scrollIntoViewIfNeeded();
  await expect(backup).toBeVisible();

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Export to file…" }).click(),
  ]);
  const path = await download.path();
  const text = (await import("node:fs")).readFileSync(path, "utf-8");
  expect(text).toContain("Ctrl+L");
  expect(text).toContain('"notifications"');
  expect(text).not.toContain("super-secret-token");

  // A file from another app is refused with a reason and nothing changes.
  await page.getByLabel("Settings backup file").setInputFiles({
    name: "other.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify({ app: "other", version: 1, groups: {} })),
  });
  await expect(page.getByText("This is not a DevDeck settings backup.")).toBeVisible();

  // A DevDeck file shows its groups; choosing Overwrite applies it and reloads.
  await page.getByLabel("Settings backup file").setInputFiles({
    name: "devdeck.json",
    mimeType: "application/json",
    buffer: Buffer.from(
      JSON.stringify({
        app: "devdeck",
        version: 1,
        exportedAt: "2026-10-18T00:00:00Z",
        groups: { keybindings: { "azdodeck:keybindings:v1": JSON.stringify({ toggleAgent: "Ctrl+K" }) } },
      }),
    ),
  });
  await page.getByLabel("Keyboard shortcuts import mode").selectOption("overwrite");
  await Promise.all([page.waitForEvent("load"), page.getByRole("button", { name: "Apply and reload" }).click()]);
  expect(await page.evaluate(() => window.localStorage.getItem("azdodeck:keybindings:v1"))).toBe(
    '{"toggleAgent":"Ctrl+K"}',
  );
});
