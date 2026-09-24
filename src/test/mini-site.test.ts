/**
 * Mini site — behaviour tests for the public station website.
 *
 * The mini site is public-facing, so the tests focus on the properties that
 * would be embarrassing or unsafe to get wrong:
 *   • the published document contains ONLY opted-in sections;
 *   • it never carries station-private data;
 *   • the slug rules are enforced (it is a public URL);
 *   • the published copy and the manager cannot disagree about content;
 *   • hours/"open now" is computed correctly, including overnight windows.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  DEFAULT_HOURS,
  DEFAULT_MINI_SITE_CONFIG,
  DEFAULT_MINI_SITE_SECTIONS,
  MINI_SITE_SECTIONS,
  buildPublishedMiniSite,
  computeOpenStatus,
  countMiniSiteShare,
  dayLabel,
  isValidMiniSiteSlug,
  miniSiteHashRoute,
  miniSitePath,
  miniSiteShortLabel,
  miniSiteUrl,
  normalizeMiniSiteConfig,
  orderedHours,
  seedMiniSiteConfig,
  slugify,
  telLink,
  whatsappLink,
  type MiniSiteConfig,
} from "@/react-app/lib/mini-site-service";

const BASE_CONFIG: MiniSiteConfig = {
  ...DEFAULT_MINI_SITE_CONFIG,
  slug: "publican-energy",
  published: true,
  siteName: "Publican Energy",
  headline: "Publican Energy",
  tagline: "Fuel you trust",
  about: "We serve the community.",
  phone: "+254700000000",
  email: "hello@publican.test",
  address: "Moi Avenue, Nairobi",
};

describe("slug rules (the public URL)", () => {
  it("accepts simple lowercase slugs", () => {
    expect(isValidMiniSiteSlug("publican-energy")).toBe(true);
    expect(isValidMiniSiteSlug("abc")).toBe(true);
    expect(isValidMiniSiteSlug("station-1")).toBe(true);
  });

  it("rejects slugs that would make a broken or ambiguous URL", () => {
    expect(isValidMiniSiteSlug("")).toBe(false);
    expect(isValidMiniSiteSlug("ab")).toBe(false);
    expect(isValidMiniSiteSlug("Has-Uppercase")).toBe(false);
    expect(isValidMiniSiteSlug("-leading")).toBe(false);
    expect(isValidMiniSiteSlug("trailing-")).toBe(false);
    expect(isValidMiniSiteSlug("has space")).toBe(false);
    expect(isValidMiniSiteSlug("has/slash")).toBe(false);
    expect(isValidMiniSiteSlug("has_underscore")).toBe(false);
  });

  it("slugify produces a valid slug from a station name", () => {
    const slug = slugify("The Publican Energy & Fuel Co.");
    expect(isValidMiniSiteSlug(slug)).toBe(true);
    expect(slug).toBe("the-publican-energy-fuel-co");
  });

  it("slugify never leaves a trailing/leading dash", () => {
    expect(slugify("  --Weird Name--  ")).toMatch(/^[a-z0-9]/);
    expect(slugify("  --Weird Name--  ")).toMatch(/[a-z0-9]$/);
  });

  it("builds the site URL and path", () => {
    expect(miniSitePath("publican-energy")).toBe("/site/publican-energy");
    expect(miniSiteUrl("publican-energy")).toContain("/site/publican-energy");
    expect(miniSiteUrl("publican-energy")).toMatch(/^https?:\/\//);
    // The shared address must be the CLEAN path, with no '#'. A hash-form
    // canonical is invisible to crawlers (they drop the fragment), so every
    // mini site would otherwise declare the SAME canonical URL.
    expect(miniSiteUrl("publican-energy")).not.toContain("#");
    expect(miniSitePath("publican-energy")).not.toContain("#");
  });

  it("keeps a distinct hash route for in-app navigation", () => {
    expect(miniSiteHashRoute("publican-energy")).toBe("#/site/publican-energy");
    expect(miniSiteShortLabel("publican-energy")).toBe("/site/publican-energy");
  });
});

describe("seed and normalize", () => {
  it("seeds a config from the station for a first-time owner", () => {
    const seeded = seedMiniSiteConfig({
      name: "Publican Energy",
      code: "PUB-1",
      location: "Moi Avenue, Nairobi",
      phone: "+254700000000",
      email: "hello@publican.test",
      logo: "https://cdn.test/logo.png",
      country: "KE",
    });
    expect(seeded.slug).toBe("publican-energy");
    expect(seeded.headline).toBe("Publican Energy");
    expect(seeded.address).toBe("Moi Avenue, Nairobi");
    expect(seeded.phone).toBe("+254700000000");
    expect(seeded.logoUrl).toBe("https://cdn.test/logo.png");
    // Seeded but NOT published — publishing is an explicit owner action.
    expect(seeded.published).toBe(false);
    expect(seeded.hours).toEqual(DEFAULT_HOURS);
  });

  it("never overwrites an existing config's chosen slug or published flag", () => {
    const existing = normalizeMiniSiteConfig({
      ...BASE_CONFIG,
      slug: "my-chosen-name",
      published: true,
      headline: "Custom headline",
    });
    const reseeded = seedMiniSiteConfig(
      { name: "Different Name", location: "Elsewhere" },
      existing,
    );
    expect(reseeded.slug).toBe("my-chosen-name");
    expect(reseeded.published).toBe(true);
    expect(reseeded.headline).toBe("Custom headline");
  });

  it("normalize coerces junk into a usable shape", () => {
    const n = normalizeMiniSiteConfig({
      slug: "Not A Slug!",
      sections: ["about", "nonsense", "prices"] as never,
      services: [{ title: "Car wash" } as never, null as never],
      hours: [{ day: 1, open: "6:00", close: "21:00" }] as never,
    } as never);
    expect(n.slug).toBe("not-a-slug");
    // Unknown section keys are dropped, not published.
    expect(n.sections).not.toContain("nonsense");
    expect(n.sections).toContain("about");
    expect(n.sections).toContain("prices");
    // A malformed service entry is dropped rather than crashing the page.
    expect(n.services.length).toBe(1);
    expect(n.services[0].title).toBe("Car wash");
    // Hours are backfilled to a full week.
    expect(n.hours.length).toBe(7);
  });
});

describe("published document", () => {
  it("carries only sections the owner enabled", () => {
    const config = normalizeMiniSiteConfig({
      ...BASE_CONFIG,
      sections: ["about", "contact"],
    });
    const doc = buildPublishedMiniSite(config, {
      fuelPrices: [{ label: "Super Petrol", price: 1.42, unit: "L" }],
      currencySymbol: "$",
      webStudio: {
        team: [{ name: "Jane", role: "Manager", status: "published" }],
        blog: [{ title: "Post", status: "published", excerpt: "x" }],
      },
    });
    expect(doc.sections).toEqual(["about", "contact"]);
    // Content exists for these, but they are switched off, so nothing renders.
    expect(doc.sections).not.toContain("prices");
    expect(doc.sections).not.toContain("team");
    expect(doc.sections).not.toContain("blog");
    expect(doc.prices).toEqual([]);
    expect(doc.team).toEqual([]);
    expect(doc.blog).toEqual([]);
  });

  it("publishes only PUBLISHED Web Studio content", () => {
    const config = normalizeMiniSiteConfig({
      ...BASE_CONFIG,
      sections: ["blog", "team", "testimonials", "careers"],
    });
    const doc = buildPublishedMiniSite(config, {
      fuelPrices: [],
      currencySymbol: "KSh",
      webStudio: {
        blog: [
          { title: "Live post", status: "published", excerpt: "a" },
          { title: "Draft post", status: "draft", excerpt: "b" },
        ],
        // Team members and testimonials have no draft/published state in Web
        // Studio — they are always intended to be public once the section is
        // switched on, and a stray `status` key on the input is ignored.
        // Only BLOG posts and JOB openings carry a status.
        team: [
          { name: "Jane", role: "Manager" },
          { name: "Also Listed", role: "Staff" },
        ],
        testimonials: [{ author: "A", quote: "Great", rating: 5 }],
        jobs: [
          { title: "Attendant", status: "open" },
          { title: "Secret", status: "closed" },
        ],
      },
    });
    expect(doc.blog.map((b) => b.title)).toEqual(["Live post"]);
    expect(doc.team.map((t) => t.name)).toEqual(["Jane", "Also Listed"]);
    expect(doc.testimonials.map((t) => t.author)).toEqual(["A"]);
    expect(doc.careers.map((c) => c.title)).toEqual(["Attendant"]);
  });

  it("ignores a stray status key on team / testimonial input", () => {
    // A caller passing `status` on one of these must not be able to smuggle a
    // draft-looking record through (or hide a legitimate one) — the field
    // simply is not part of these entities.
    const config = normalizeMiniSiteConfig({
      ...BASE_CONFIG,
      sections: ["team"],
    });
    const doc = buildPublishedMiniSite(config, {
      fuelPrices: [],
      currencySymbol: "$",
      webStudio: {
        team: [{ name: "Jane", role: "Manager", status: "draft" }],
      },
    });
    expect(doc.team.map((t) => t.name)).toEqual(["Jane"]);
  });

  it("drops images and captions from unapproved content fields", () => {
    const config = normalizeMiniSiteConfig({
      ...BASE_CONFIG,
      sections: ["team", "gallery"],
    });
    const doc = buildPublishedMiniSite(config, {
      fuelPrices: [],
      currencySymbol: "$",
      webStudio: {
        team: [
          {
            name: "Jane",
            role: "Manager",
            status: "published",
            // These must NOT leak into the public document.
            salary: 90000,
            nationalId: "12345678",
            bankAccount: "0123456789",
          },
        ],
      },
    });
    const asJson = JSON.stringify(doc);
    expect(asJson).not.toContain("salary");
    expect(asJson).not.toContain("90000");
    expect(asJson).not.toContain("nationalId");
    expect(asJson).not.toContain("12345678");
    expect(asJson).not.toContain("bankAccount");
    expect(asJson).not.toContain("0123456789");
  });

  it("never includes operator-only or login data anywhere in the payload", () => {
    const config = normalizeMiniSiteConfig(BASE_CONFIG);
    const doc = buildPublishedMiniSite(config, {
      fuelPrices: [{ label: "Diesel", price: 1.51, unit: "L" }],
      currencySymbol: "$",
      webStudio: { team: [{ name: "Jane" }] },
    });
    const asJson = JSON.stringify(doc);
    for (const forbidden of [
      "ownerId",
      "owner_id",
      "should-not-leak",
      "password",
      "access_code",
      "mpesa",
      "payroll",
      "expense",
      "credit_account",
    ]) {
      expect(asJson.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
  });

  it("keeps the published copy in step with the manager's own content", () => {
    const config = normalizeMiniSiteConfig({
      ...BASE_CONFIG,
      headline: "Exactly this headline",
      tagline: "Exactly this tagline",
      sections: ["about", "services", "hours", "contact"],
      services: [{ id: "s1", title: "Car wash", description: "Fast" }],
    });
    const doc = buildPublishedMiniSite(config, {
      fuelPrices: [],
      currencySymbol: "$",
    });
    expect(doc.headline).toBe(config.headline);
    expect(doc.tagline).toBe(config.tagline);
    // With no station name supplied, the published site name follows the
    // headline — the owner's chosen title is what the public page shows.
    expect(doc.siteName).toBe(config.headline);
    expect(doc.services).toEqual(config.services);
    expect(doc.hours).toEqual(config.hours);
    expect(doc.sections).toEqual(config.sections);
    expect(doc.currencySymbol).toBe("$");
  });

  it("uses the station name over an empty config name", () => {
    const config = normalizeMiniSiteConfig({ ...BASE_CONFIG, siteName: "" });
    const doc = buildPublishedMiniSite(config, {
      fuelPrices: [],
      currencySymbol: "$",
      siteName: "Real Station Name",
    });
    expect(doc.siteName).toBe("Real Station Name");
  });

  it("falls back to a non-empty schema type and preset", () => {
    const doc = buildPublishedMiniSite(normalizeMiniSiteConfig(BASE_CONFIG), {
      fuelPrices: [],
      currencySymbol: "$",
    });
    expect(doc.schemaType).toBeTruthy();
    expect(doc.theme.preset).toBeTruthy();
    expect(doc.theme.primary).toMatch(/^#/);
  });

  it("ignores non-finite or non-positive fuel prices", () => {
    const config = normalizeMiniSiteConfig({
      ...BASE_CONFIG,
      sections: ["about", "prices"],
    });
    const doc = buildPublishedMiniSite(config, {
      fuelPrices: [
        { label: "Good", price: 1.42, unit: "L" },
        { label: "Zero", price: 0, unit: "L" },
        { label: "NaN", price: Number.NaN, unit: "L" },
        { label: "Negative", price: -3, unit: "L" },
      ],
      currencySymbol: "$",
    });
    expect(doc.prices.map((p) => p.label)).toEqual(["Good"]);
  });
});

describe("opening hours", () => {
  it("labels days in a stable Monday-first order", () => {
    expect(dayLabel(0)).toBe("Sunday");
    expect(dayLabel(1)).toBe("Monday");
    expect(dayLabel(6)).toBe("Saturday");
    expect(orderedHours(DEFAULT_HOURS)[0].day).toBe(1);
    expect(orderedHours(DEFAULT_HOURS)[6].day).toBe(0);
  });

  it("reports open during a normal daytime window", () => {
    // 2026-09-24 is a Thursday (day 4) in UTC.
    const hours = DEFAULT_HOURS.map((h) =>
      h.day === 4 ? { ...h, open: "08:00", close: "18:00" } : h,
    );
    const status = computeOpenStatus(hours, new Date("2026-09-24T10:00:00"));
    expect(status.open).toBe(true);
    expect(status.label).toContain("18:00");
  });

  it("reports closed outside the window and on a closed day", () => {
    const hours = DEFAULT_HOURS.map((h) =>
      h.day === 4 ? { ...h, open: "08:00", close: "18:00" } : h,
    );
    const before = computeOpenStatus(hours, new Date("2026-09-24T06:30:00"));
    expect(before.open).toBe(false);
    expect(before.label).toContain("08:00");

    const closedDay = hours.map((h) =>
      h.day === 4 ? { ...h, closed: true } : h,
    );
    expect(
      computeOpenStatus(closedDay, new Date("2026-09-24T10:00:00")).open,
    ).toBe(false);
  });

  it("handles an overnight window (closes after midnight)", () => {
    const hours = DEFAULT_HOURS.map((h) =>
      h.day === 4 ? { ...h, open: "20:00", close: "02:00" } : h,
    );
    // 23:00 on Thursday is inside 20:00–02:00.
    expect(computeOpenStatus(hours, new Date("2026-09-24T23:00:00")).open).toBe(
      true,
    );
    // 01:00 Thursday is also inside (the window began Wednesday).
    expect(computeOpenStatus(hours, new Date("2026-09-24T01:00:00")).open).toBe(
      true,
    );
    // 12:00 Thursday is outside it.
    expect(computeOpenStatus(hours, new Date("2026-09-24T12:00:00")).open).toBe(
      false,
    );
  });

  it("reports closed with no label when no hours are configured", () => {
    const status = computeOpenStatus([]);
    expect(status.open).toBe(false);
    expect(status.label).toBeNull();
  });
});

describe("share helpers", () => {
  it("builds a WhatsApp link only when there is a number", () => {
    expect(whatsappLink("")).toBe("");
    expect(whatsappLink("+254 700 000 000", "Hi")).toContain(
      "wa.me/254700000000",
    );
    expect(whatsappLink("+254700000000", "Hi")).toContain(
      encodeURIComponent("Hi"),
    );
  });

  it("builds a tel link only when there is a number", () => {
    expect(telLink("")).toBe("");
    expect(telLink("+254 700 000 000")).toBe("tel:+254700000000");
  });

  it("counts shares without ever throwing on an unknown slug", () => {
    expect(() =>
      countMiniSiteShare("definitely-not-published-xyz"),
    ).not.toThrow();
  });
});

describe("section registry", () => {
  it("exposes every renderable section with a label and description", () => {
    expect(MINI_SITE_SECTIONS.length).toBeGreaterThanOrEqual(8);
    for (const s of MINI_SITE_SECTIONS) {
      expect(s.key).toBeTruthy();
      expect(s.label).toBeTruthy();
      expect(s.description).toBeTruthy();
    }
    const keys = MINI_SITE_SECTIONS.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toContain("prices");
    expect(keys).toContain("contact");
  });

  it("defaults to a sensible, non-empty section set", () => {
    expect(DEFAULT_MINI_SITE_CONFIG.sections.length).toBeGreaterThan(0);
  });

  /**
   * Every toggleable section must actually render something.
   *
   * `faqs` was offered in the manager, populated from Web Studio, and included
   * in the default section set — but the public page never rendered it. An
   * owner could tick "FAQs", fill in questions, and see nothing. A registry
   * test cannot catch that on its own, so assert the page source reads each
   * key.
   */
  it("renders every section the owner can toggle", () => {
    const page = readFileSync("src/react-app/pages/MiniSite.tsx", "utf8");
    for (const s of MINI_SITE_SECTIONS) {
      expect(
        page.includes(`sections.has("${s.key}")`),
        `MiniSite.tsx never renders the "${s.key}" section`,
      ).toBe(true);
    }
  });

  it("offers FAQs in the default section set (and they render)", () => {
    expect(DEFAULT_MINI_SITE_SECTIONS).toContain("faqs");
    const page = readFileSync("src/react-app/pages/MiniSite.tsx", "utf8");
    expect(page).toContain('sections.has("faqs")');
  });
});
