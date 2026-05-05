import { test, expect } from "@playwright/test";

test("skeleton home page loads", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /ChainReact V2/i })).toBeVisible();
});
