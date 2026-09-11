/**
 * Founder Page E2E Tests
 *
 * Tests for the founder/admin authentication and dashboard.
 */

import { test, expect } from "@playwright/test";

test.describe("Founder Page", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/#/founder");
  });

  test("should display the founder login page", async ({ page }) => {
    // Check for main heading
    await expect(
      page.getByRole("heading", { name: /Founder Access/i }),
    ).toBeVisible();

    // Check for restricted access notice
    await expect(
      page.getByText(/Restricted\. Authorized personnel only\./i),
    ).toBeVisible();

    // Check for login form
    await expect(page.getByPlaceholder(/Enter username/i)).toBeVisible();
    await expect(page.getByPlaceholder(/Enter password/i)).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Authenticate/i }),
    ).toBeVisible();
  });

  test("should have back to FuelPro link", async ({ page }) => {
    const backLink = page.getByRole("button", { name: /Back to FuelPro/i });
    await expect(backLink).toBeVisible();
  });

  test("should navigate back to main app", async ({ page }) => {
    await page.getByRole("button", { name: /Back to FuelPro/i }).click();
    await expect(page).toHaveURL(/\/$/);
  });

  test("should show error for empty credentials", async ({ page }) => {
    await page.getByRole("button", { name: /Authenticate/i }).click();

    // Should show the required-fields error message
    await expect(
      page.getByText(/username and password are required/i),
    ).toBeVisible({ timeout: 5000 });
  });

  test("should have security notice", async ({ page }) => {
    await expect(page.getByText(/Supabase Auth/i)).toBeVisible();
    await expect(page.getByText(/5-attempt lockout/i)).toBeVisible();
  });
});
