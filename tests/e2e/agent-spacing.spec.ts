import { expect, test } from "@playwright/test";

test("opens the Agent panel with its composer at the bottom", async ({ page }) => {
  await page.setViewportSize({ width: 1800, height: 900 });
  await page.goto("/");
  const grid = page.getByRole("grid", { name: "My review pull requests" });
  await expect(grid).toBeVisible();
  const panel = page.getByRole("complementary", { name: "Agent", exact: true });
  // The Agent panel starts closed; Ctrl+J opens it.
  await expect(panel).toHaveCount(0);
  await page.keyboard.press("Control+j");
  await expect(panel).toBeVisible();
  const outerScrollContainers = () => panel.evaluate((element) => {
    const containers = [];
    for (let parent = element.parentElement; parent?.closest(".dv-dockview"); parent = parent.parentElement) {
      const overflow = getComputedStyle(parent).overflowY;
      if (overflow === "auto" || overflow === "scroll") {
        containers.push(parent.className);
      }
    }
    return containers;
  });
  await expect.poll(outerScrollContainers).toEqual([]);
  // A long conversation must scroll inside the list, with no second scrollbar.
  const conversations = panel.getByLabel("Agent conversations");
  await conversations.evaluate((element) => {
    const content = document.createElement("div");
    content.style.height = "2000px";
    content.textContent = "Long conversation";
    element.appendChild(content);
  });
  await expect.poll(() => conversations.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);
  await expect.poll(outerScrollContainers).toEqual([]);
  // Ctrl+J opened it focused on the input; Esc returns to the collapsed composer.
  const input = panel.getByRole("textbox", { name: /^Ask (about|the agent)/ });
  await expect(input).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(panel.locator("[data-agent-composer]").getByRole("button")).toBeVisible();

  const trailingSpace = () =>
    panel.evaluate((element) => {
      const composer = element.querySelector("[data-agent-composer]")!;
      return element.getBoundingClientRect().bottom - composer.getBoundingClientRect().bottom;
    });
  await expect.poll(trailingSpace).toBeLessThanOrEqual(12);

  // Ctrl+J closes it, then opens it focused on the input.
  await page.keyboard.press("Control+j");
  await expect(panel).toHaveCount(0);
  await page.keyboard.press("Control+j");
  await expect(input).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(panel.locator("[data-agent-composer]").getByRole("button", { name: /^Ask (about|the agent)/ })).toBeVisible();
  await expect.poll(trailingSpace).toBeLessThanOrEqual(12);

  await page.keyboard.press("m");
  await expect(input).toBeFocused();
  await page.setViewportSize({ width: 1800, height: 480 });
  await expect.poll(outerScrollContainers).toEqual([]);
  await expect(input).toBeInViewport();
  await expect(panel.getByRole("button", { name: "Ask", exact: true })).toBeInViewport();
});

test("reaches the context chips from the input with Shift+Tab and drives them by keyboard", async ({ page }) => {
  await page.setViewportSize({ width: 1800, height: 900 });
  await page.goto("/");
  await expect(page.getByRole("grid", { name: "My review pull requests" })).toBeVisible();
  await page.keyboard.press("Control+j");
  const panel = page.getByRole("complementary", { name: "Agent", exact: true });
  const toolbar = panel.getByRole("toolbar", { name: "Agent context" });
  const subject = toolbar.getByRole("button", { name: /^Attached: !/ });
  await expect(subject).toBeVisible();

  const input = panel.getByRole("textbox", { name: /^Ask about/ });
  await expect(input).toBeFocused();
  // The model and agent pickers sit between the chips and the input.
  await page.keyboard.press("Shift+Tab");
  await expect(panel.getByRole("combobox", { name: "Model" })).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(panel.getByRole("radio", { name: "Claude" })).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(subject).toBeFocused();

  // Space detaches the subject (the chip turns dashed and keeps the focus); Space again attaches it.
  await page.keyboard.press("Space");
  await expect(toolbar.getByRole("button", { name: /^Attach: !/ })).toBeFocused();
  await expect(panel.getByRole("button", { name: /^Ask the agent/ })).toBeVisible();
  await page.keyboard.press("Space");
  await expect(subject).toBeFocused();
  await page.keyboard.press("p");
  await expect(toolbar.getByRole("button", { name: "Unpin the subject" })).toBeVisible();

  // Esc returns to the input without closing the panel.
  await page.keyboard.press("Escape");
  await expect(input).toBeFocused();
  await expect(panel).toBeVisible();
});
