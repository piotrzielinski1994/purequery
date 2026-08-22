import { expect, test } from "@playwright/test";

test.describe("query core flows (AC-105 / F4)", () => {
  test("should load the seeded demo workspace into the navigator", async ({
    page,
  }) => {
    await page.goto("/");

    const navigator = page.getByRole("tree", { name: "Navigator" });
    await expect(navigator).toBeVisible();
    await expect(page.getByText("Chinook")).toBeVisible();
    await expect(page.getByText("demos")).toBeVisible();
  });

  test("should open settings and toggle the theme mode", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("Chinook")).toBeVisible();

    await page.goto("/settings");

    await expect(page.getByRole("heading", { name: /^theme$/i })).toBeVisible();

    const dark = page.getByRole("button", { name: "Dark" });
    await dark.click();
    await expect(dark).toHaveAttribute("aria-pressed", "true");
  });
});
