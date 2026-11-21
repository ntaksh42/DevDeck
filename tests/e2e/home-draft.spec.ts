import { expect, test } from "@playwright/test";

test("keeps an Orchestrator draft until the user confirms replacement", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("grid", { name: "My review pull requests" }).waitFor();
  await page.keyboard.press("g");
  await page.keyboard.press("h");

  const composer = page.getByRole("textbox", { name: "Message the Orchestrator" });
  const ask = page.getByRole("button", { name: /Ask Orchestrator/ });
  const dialog = page.getByRole("alertdialog", { name: "Replace your draft?" });
  await composer.fill("My unsent message");
  await composer.press("Escape");
  await page.keyboard.press("q");
  await expect(dialog.getByRole("button", { name: "Keep draft" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(composer).toHaveValue("My unsent message");

  await ask.click();
  await expect(dialog.getByRole("button", { name: "Keep draft" })).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(dialog.getByRole("button", { name: "Replace draft" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(dialog).toBeHidden();
  await expect(composer).not.toHaveValue("My unsent message");
  await expect(composer).not.toHaveValue("");
  await expect(composer).toBeFocused();

  await page.getByRole("button", { name: "New chat", exact: true }).click();
  const starterText = "!798 の CI 失敗が最優先 について詳しく";
  const starter = page.getByRole("button", { name: starterText, exact: true });
  await starter.click();
  await dialog.getByRole("button", { name: "Replace draft" }).click();
  await expect(composer).toHaveValue(starterText);
});
