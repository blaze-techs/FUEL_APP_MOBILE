import { describe, it, expect } from "vitest";
import {
  applySeoMeta,
  applyTabSeo,
  applyLocalBusinessSchema,
  applyBreadcrumbSchema,
  ROUTE_SEO,
  TAB_SEO,
  SITE_URL,
} from "@/react-app/lib/seo";

describe("seo.ts", () => {
  it("applies route meta: title, description, canonical, robots, OG", () => {
    applySeoMeta(ROUTE_SEO["/sign-in"]);
    expect(document.title).toBe("Sign In — FuelPro");
    expect(
      document
        .querySelector('meta[name="description"]')
        ?.getAttribute("content"),
    ).toContain("Sign in to FuelPro");
    expect(
      document.querySelector('link[rel="canonical"]')?.getAttribute("href"),
    ).toBe(`${SITE_URL}/sign-in`);
    expect(
      document.querySelector('meta[name="robots"]')?.getAttribute("content"),
    ).toBe("index, follow");
    expect(
      document
        .querySelector('meta[property="og:url"]')
        ?.getAttribute("content"),
    ).toBe(`${SITE_URL}/sign-in`);
    expect(
      document
        .querySelector('meta[name="twitter:image"]')
        ?.getAttribute("content"),
    ).toBe(`${SITE_URL}/og-image.png`);
  });

  it("applies unique tab titles + noindex for every registered tab", () => {
    const titles = new Set<string>();
    for (const tabId of Object.keys(TAB_SEO)) {
      applyTabSeo(tabId);
      expect(document.title).toContain("— FuelPro");
      expect(document.title).not.toBe("— FuelPro");
      titles.add(document.title);
      expect(
        document.querySelector('meta[name="robots"]')?.getAttribute("content"),
      ).toBe("noindex, nofollow");
    }
    // every tab gets a distinct document title
    expect(titles.size).toBe(Object.keys(TAB_SEO).length);
  });

  it("falls back to the label for unknown tabs", () => {
    applyTabSeo("nonexistent-tab", "Custom Label");
    expect(document.title).toBe("Custom Label — FuelPro");
  });

  it("injects LocalBusiness (GasStation) schema", () => {
    applyLocalBusinessSchema({
      name: "Test Station",
      location: "1 Test Ave",
      country: "KE",
      currency: "KES",
    });
    const el = document.getElementById("ld-local-business");
    expect(el).toBeTruthy();
    const data = JSON.parse(el!.textContent!);
    expect(data["@type"]).toBe("GasStation");
    expect(data.name).toBe("Test Station");
    expect(data.address.addressCountry).toBe("KE");
  });

  it("injects BreadcrumbList schema with the current view", () => {
    applyBreadcrumbSchema("Point of Sale");
    const el = document.getElementById("ld-breadcrumb");
    const data = JSON.parse(el!.textContent!);
    expect(data["@type"]).toBe("BreadcrumbList");
    expect(data.itemListElement[1].name).toBe("Point of Sale");
  });

  it("never references the old placeholder domains", () => {
    applySeoMeta(ROUTE_SEO["/"]);
    const head = document.head.innerHTML;
    expect(head).not.toContain("mocha");
    expect(head).not.toContain("get_mocha");
    expect(head).not.toContain("Vite");
    expect(head).not.toContain("React +");
  });
});
