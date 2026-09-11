/**
 * Login Page E2E Tests
 *
 * Tests for the authentication flow.
 */

import { test, expect } from "@playwright/test";

test.describe("Login Page", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("should display the login page correctly", async ({ page }) => {
    // Check for main heading
    await expect(page.getByRole("heading", { name: /FuelPro/i })).toBeVisible();

    // Check for login form elements
    await expect(page.getByPlaceholder(/you@company\.com/i)).toBeVisible();
    await expect(page.getByPlaceholder(/Enter your password/i)).toBeVisible();
    // Exact "Sign In" — avoids matching the "Sign in with Google" button.
    await expect(page.getByRole("button", { name: /^Sign In$/ })).toBeVisible();
  });

  test("should show error for invalid credentials", async ({ page }) => {
    await page.getByPlaceholder(/you@company\.com/i).fill("test@invalid.com");
    await page.getByPlaceholder(/Enter your password/i).fill("wrongpassword");
    await page.getByRole("button", { name: /^Sign In$/ }).click();

    // Should show an error message (Supabase returns "Invalid login credentials";
    // the fallback is "Invalid email or password").
    await expect(page.getByText(/invalid/i)).toBeVisible({ timeout: 10000 });
  });

  test("should have working toggle between Email and Username", async ({
    page,
  }) => {
    // The active tab uses the indigo background; Email is active by default.
    await expect(page.getByRole("button", { name: /^Email$/ })).toHaveClass(
      /bg-indigo-600/,
    );

    // Click Username
    await page.getByRole("button", { name: /Username/i }).click();

    // Username tab should now be active
    await expect(page.getByRole("button", { name: /Username/i })).toHaveClass(
      /bg-indigo-600/,
    );
  });

  test("should have forgot password link", async ({ page }) => {
    const forgotButton = page.getByRole("button", { name: /Forgot Password/i });
    await expect(forgotButton).toBeVisible();
  });

  test("should navigate to reset password page", async ({ page }) => {
    await page.getByRole("button", { name: /Forgot Password/i }).click();
    await expect(page).toHaveURL(/\/reset-password/);
  });

  test("should have create account link", async ({ page }) => {
    const createButton = page.getByRole("button", { name: /Create one/i });
    await expect(createButton).toBeVisible();
  });
});
