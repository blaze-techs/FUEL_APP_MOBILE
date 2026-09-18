import { test, expect, type Page } from "@playwright/test";

async function login(page: Page) {
  const signupEmail = process.env.E2E_SIGNUP_EMAIL;
  const signupPassword = process.env.E2E_SIGNUP_PASSWORD;
  if (signupEmail && signupPassword) {
    const unique = signupEmail.replace("@", `+${Date.now()}@`);
    await page.goto("/sign-up");
    await page.getByPlaceholder("Your full name").fill("FuelPro E2E");
    await page.getByPlaceholder("you@company.com").fill(unique);
    await page.getByPlaceholder("Min 6 characters").fill(signupPassword);
    await page.getByPlaceholder("Repeat password").fill(signupPassword);
    await page.getByRole("button", { name: /Create Account/i }).click();
    await page.waitForTimeout(1500);
    const token = await sessionToken(page);
    if (token) return token;
  }

  const email = process.env.E2E_TEST_EMAIL;
  const password = process.env.E2E_TEST_PASSWORD;
  test.skip(!email || !password, "Set E2E_TEST_EMAIL and E2E_TEST_PASSWORD (or signup credentials) for the canonical flow.");
  await page.goto("/sign-in");
  await page.getByPlaceholder("you@company.com").fill(email!);
  await page.getByPlaceholder("Enter your password").fill(password!);
  await page.getByRole("button", { name: /^Sign In$/i }).click();
  await page.waitForFunction(() => Object.keys(localStorage).some((k) => k.startsWith("sb-") && k.endsWith("-auth-token")), null, { timeout: 15000 });
  const token = await sessionToken(page);
  if (!token) throw new Error("Supabase access token not found after login");
  return token;
}

async function sessionToken(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    for (const key of Object.keys(localStorage)) {
      if (!key.startsWith("sb-") || !key.endsWith("-auth-token")) continue;
      try {
        const parsed = JSON.parse(localStorage.getItem(key) || "{}");
        return parsed?.access_token || parsed?.currentSession?.access_token || null;
      } catch {
        // continue
      }
    }
    return null;
  });
}

async function api(page: Page, token: string, path: string, body?: unknown, method: "GET" | "POST" = "POST") {
  const response = await page.request.fetch(path, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    data: body,
  });
  const text = await response.text();
  let json: any = {};
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  expect(response.ok(), `${method} ${path}: ${text}`).toBeTruthy();
  return json;
}

test.describe("Canonical station operational lifecycle", () => {
  test("registration/login → station → day shift → sale/reversal → close → report → night continuity → reopen", async ({ page }) => {
    test.setTimeout(120_000);
    const token = await login(page);
    const suffix = Date.now().toString(36);
    let stationId = "";

    try {
      const station = await api(page, token, "/api/operations/station?action=create", {
        name: `E2E Canonical ${suffix}`,
        location: "CI",
        country: "Kenya",
        currency: "KES",
        currencySymbol: "KSh",
        timezone: "Africa/Nairobi",
      });
      stationId = station.data.id;
      expect(stationId).toBeTruthy();

      const mapped = await api(page, token, "/api/operations/pumps?action=ensure-map", {
        stationId,
        pumpNumber: "1",
        nozzleCode: "1-1",
        fuelCode: "PMS",
        fuelName: "Petrol",
        pricePerLiter: 220,
      });
      const nozzleId = mapped.data.nozzle.id;
      expect(nozzleId).toBeTruthy();

      const businessDate = new Date().toISOString().slice(0, 10);
      const day = await api(page, token, "/api/operations/shift?action=open", {
        stationId, shiftDate: businessDate, shiftType: "day",
      });
      const dayShiftId = day.data.id;

      const sale = await api(page, token, "/api/operations/sale?action=post", {
        stationId, shiftId: dayShiftId, nozzleId, litres: 10, unitPrice: 220,
        taxAmount: 0, paymentStatus: "paid", receiptNumber: `E2E-${suffix}-1`,
        idempotencyKey: `e2e-${suffix}-sale-1`,
      });
      expect(Number(sale.data.gross_amount)).toBe(2200);

      const correctionSale = await api(page, token, "/api/operations/sale?action=post", {
        stationId, shiftId: dayShiftId, nozzleId, litres: 1, unitPrice: 220,
        taxAmount: 0, paymentStatus: "paid", receiptNumber: `E2E-${suffix}-2`,
        idempotencyKey: `e2e-${suffix}-sale-2`,
      });
      const reversal = await api(page, token, "/api/operations/sale?action=reverse", {
        saleId: correctionSale.data.id, reason: "E2E correction",
        idempotencyKey: `e2e-${suffix}-reversal-2`,
      });
      expect(Number(reversal.data.gross_amount)).toBe(-220);

      const closedDay = await api(page, token, "/api/operations/shift?action=close", {
        shiftId: dayShiftId,
        meters: [{ nozzle_id: nozzleId, opening_meter: 1000, closing_meter: 1010, price_per_liter: 220, actual_sales: 2200 }],
        payments: [{ payment_method: "cash", expected_amount: 2200, counted_amount: 2200 }],
      });
      expect(closedDay.data.status).toBe("closed");

      const report = await api(page, token, `/api/reports/canonical?stationId=${stationId}&start=${businessDate}&end=${businessDate}`, undefined, "GET");
      expect(report.source).toBe("canonical_station_daily_summary");
      expect(Number(report.totals.gross)).toBe(2200);
      expect(Number(report.totals.reversals)).toBe(1);

      const night = await api(page, token, "/api/operations/shift?action=open", {
        stationId, shiftDate: businessDate, shiftType: "night",
      });
      const nightShiftId = night.data.id;

      const closedNight = await api(page, token, "/api/operations/shift?action=close", {
        shiftId: nightShiftId,
        meters: [{ nozzle_id: nozzleId, opening_meter: 1010, closing_meter: 1015, price_per_liter: 220, actual_sales: 1100 }],
        payments: [{ payment_method: "cash", expected_amount: 1100, counted_amount: 1100 }],
      });
      expect(closedNight.data.status).toBe("closed");

      const reopened = await api(page, token, "/api/operations/shift?action=reopen", {
        shiftId: nightShiftId, reason: "E2E authorized reopen",
      });
      expect(reopened.data.status).toBe("reopened");

      const reclosed = await api(page, token, "/api/operations/shift?action=close", {
        shiftId: nightShiftId, meters: [], payments: [], varianceReason: "No ledger changes",
      });
      expect(reclosed.data.status).toBe("closed");
    } finally {
      if (stationId) {
        await api(page, token, "/api/operations/station?action=archive", { stationId }).catch(() => undefined);
      }
    }
  });
});
