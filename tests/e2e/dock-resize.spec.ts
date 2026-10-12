import { expect, test } from "@playwright/test";

test("a pane boundary keeps working after the neighbouring panes are re-docked", async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 850 });
  await page.goto("/");
  const main = page.getByRole("main");
  await main
    .getByRole("grid", { name: "My review pull requests" })
    .getByText("Add rate limiting middleware to all endpoints")
    .click();

  const groupWidth = (title: string) =>
    page.evaluate(
      (name) =>
        [...document.querySelectorAll(".dv-groupview")]
          .find((group) => group.querySelector(".dv-tab")?.textContent === name)
          ?.getBoundingClientRect().width ?? 0,
      title,
    );

  // Agent moves between Reviews and Conversation. Conversation keeps its
  // header actions but its neighbour on the left is now Agent, so the handle
  // has to resize that pair instead of the one it was mounted next to.
  await main.getByRole("button", { name: "Move Agent panel" }).click();
  await page
    .getByRole("menu", { name: "Move Agent" })
    .getByRole("menuitem", { name: "Split left of Conversation" })
    .click();
  await expect(page.getByRole("separator", { name: "Resize Agent" })).toBeVisible();

  const reviews = await groupWidth("Reviews");
  const conversation = await groupWidth("Conversation");
  const agent = await groupWidth("Agent");
  expect(agent).toBeGreaterThan(300 + 40);

  const box = await page.getByRole("separator", { name: "Resize Conversation" }).boundingBox();
  if (!box) throw new Error("Conversation has no resize handle");
  const x = box.x + box.width / 2;
  const y = box.y + 40;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x - 40, y, { steps: 6 });
  await page.mouse.up();

  await expect.poll(() => groupWidth("Conversation")).toBeGreaterThan(conversation + 20);
  expect(await groupWidth("Agent")).toBeLessThan(agent - 20);
  expect(await groupWidth("Reviews")).toBe(reviews);
});
