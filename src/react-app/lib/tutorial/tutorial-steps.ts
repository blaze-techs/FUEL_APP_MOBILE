/**
 * Adaptive onboarding tutorial content.
 *
 * Two parts:
 *   - BASIC: day-to-day features every user needs.
 *   - ADVANCED: day-to-day recap + complex/technical features for skilled
 *     operators (analytics, integrations, founder admin console, compliance).
 *
 * Steps are ADAPTIVE: each step declares an optional `applies` predicate
 * evaluated against the live feature flags + canonical tab list + registered
 * founder sections. Steps for features not available in the user's
 * tenant/region are dropped automatically, keeping the tutorial in sync with
 * the site as features are added, removed, or country-gated.
 *
 * One-time experience: completion persisted per-user under
 * SETUP_KEYS.ONBOARDING_COMPLETE. Replayable from the Header.
 */

import type { FeatureFlags } from "@/react-app/context/TenantContext";

export type TutorialAudience = "basic" | "advanced";

export interface TutorialStep {
  id: string;
  audience: TutorialAudience;
  title: string;
  body: string;
  emoji?: string;
  /** Live element selector to spotlight. Step still renders if missing. */
  targetSelector?: string;
  isFinal?: boolean;
  applies?: (ctx: TutorialAdaptiveContext) => boolean;
}

export interface TutorialAdaptiveContext {
  featureFlags: FeatureFlags;
  availableTabs: string[];
  founderSections: string[];
  country: string;
}

/* ---------------- BASIC ---------------- */

const BASIC_INTRO: TutorialStep[] = [
  {
    id: "welcome",
    audience: "basic",
    title: "Welcome to FuelPro 👋",
    emoji: "⛽",
    body: "FuelPro is an all-in-one fuel-station management platform. This quick tour shows the day-to-day features you'll use most. It takes about 2 minutes — you can Skip anytime or Remind me later if you're busy.",
  },
  {
    id: "what-is",
    audience: "basic",
    title: "What it's for",
    emoji: "🎯",
    body: "Run sales, track fuel inventory & deliveries, manage customer credit, send invoices, run payroll, and view reports — all from one dashboard. Built for single or multi-station fuel businesses.",
  },
  {
    id: "who-when-where",
    audience: "basic",
    title: "Who, when & where",
    emoji: "🌍",
    body: "Used by station owners, attendants, cashiers and accountants — on phone, tablet or desktop. Works online or offline and syncs across devices. Regional features (M-PESA, KRA/eTIMS, VAT) adapt to your country automatically.",
  },
];

const BASIC_TAB_STEPS: TutorialStep[] = [
  {
    id: "tab-dashboard",
    audience: "basic",
    title: "Dashboard — your home base",
    emoji: "📊",
    body: "The Dashboard shows today's sales, fuel levels, alerts and quick actions. Start here every morning to see how the station is doing at a glance.",
    targetSelector: '[data-tab="dashboard"], [data-tab-id="dashboard"]',
    applies: (c) => c.availableTabs.includes("dashboard"),
  },
  {
    id: "tab-pos",
    audience: "basic",
    title: "Point of Sale — ring up sales",
    emoji: "🧾",
    body: "Use Point of Sale for quick fuel & shop sales with receipt printing. Cashiers use this all day for every transaction.",
    targetSelector: '[data-tab="pos"], [data-tab-id="pos"]',
    applies: (c) => c.featureFlags.pos && c.availableTabs.includes("pos"),
  },
  {
    id: "tab-sales",
    audience: "basic",
    title: "Sales Tracking — monitor pump sales",
    emoji: "⛽",
    body: "Record and monitor pump sales and daily operations. Attendants log readings here; owners review the day's performance.",
    targetSelector: '[data-tab="sales"], [data-tab-id="sales"]',
    applies: (c) => c.featureFlags.sales && c.availableTabs.includes("sales"),
  },
  {
    id: "tab-inventory",
    audience: "basic",
    title: "Stock Management — never run dry",
    emoji: "📦",
    body: "Track fuel and shop stock levels, set reorder points, and record new stock. The system warns you before you run out.",
    targetSelector: '[data-tab="inventory"], [data-tab-id="inventory"]',
    applies: (c) =>
      c.featureFlags.inventory && c.availableTabs.includes("inventory"),
  },
  {
    id: "tab-offloading",
    audience: "basic",
    title: "Fuel Offloading — record deliveries received",
    emoji: "🚛",
    body: "Log every fuel delivery received from suppliers (litres, supplier, price). Keeps tank levels accurate for reconciliation.",
    targetSelector: '[data-tab="offloading"], [data-tab-id="offloading"]',
    applies: (c) => c.availableTabs.includes("offloading"),
  },
  {
    id: "tab-invoice",
    audience: "basic",
    title: "Invoice — bill your customers",
    emoji: "🧾",
    body: "Generate and manage customer and sales invoices. Credit customers get statements here; accountants reconcile from these.",
    targetSelector: '[data-tab="invoice"], [data-tab-id="invoice"]',
    applies: (c) => c.availableTabs.includes("invoice"),
  },
  {
    id: "tab-credit",
    audience: "basic",
    title: "Credit — manage customer credit accounts",
    emoji: "💳",
    body: "Track who owes you, send reminders, and record repayments. Essential for fleet and regular credit customers.",
    targetSelector: '[data-tab="credit"], [data-tab-id="credit"]',
    applies: (c) => c.availableTabs.includes("credit"),
  },
  {
    id: "tab-mpesa",
    audience: "basic",
    title: "M-PESA Analyzer — mobile money reconciliation",
    emoji: "📲",
    body: "Import or analyze M-PESA statements to match payments to sales. Available in Kenya & Tanzania.",
    targetSelector: '[data-tab="mpesa"], [data-tab-id="mpesa"]',
    applies: (c) => c.featureFlags.mpesa && c.availableTabs.includes("mpesa"),
  },
  {
    id: "tab-payroll",
    audience: "basic",
    title: "Payroll System — pay your team",
    emoji: "👥",
    body: "Manage employees, shifts, and run payroll. Calculates pay in your station's currency and records payouts.",
    targetSelector: '[data-tab="payroll"], [data-tab-id="payroll"]',
    applies: (c) =>
      c.featureFlags.payroll && c.availableTabs.includes("payroll"),
  },
  {
    id: "tab-customers",
    audience: "basic",
    title: "Customers — loyalty & rewards",
    emoji: "🏆",
    body: "Run a customer loyalty program: points, tiers, and rewards. Great for retaining regulars.",
    targetSelector: '[data-tab="customers"], [data-tab-id="customers"]',
    applies: (c) =>
      c.featureFlags.loyalty && c.availableTabs.includes("customers"),
  },
  {
    id: "tab-reports",
    audience: "basic",
    title: "Reports Center — know your numbers",
    emoji: "📈",
    body: "Generate business reports: sales, fuel, profit, tax. Export to PDF/Excel for accountants and meetings.",
    targetSelector: '[data-tab="reports"], [data-tab-id="reports"]',
    applies: (c) => c.availableTabs.includes("reports"),
  },
  {
    id: "tab-data",
    audience: "basic",
    title: "Data Manager — backup & restore",
    emoji: "💾",
    body: "Back up your data, restore from a backup, and manage cloud sync. Do this regularly so you never lose records.",
    targetSelector: '[data-tab="data"], [data-tab-id="data"]',
    applies: (c) => c.availableTabs.includes("data"),
  },
  {
    id: "tab-team",
    audience: "basic",
    title: "Team Manager — invite your staff",
    emoji: "🤝",
    body: "Invite attendants, cashiers and accountants, assign roles, and schedule shifts. Each member syncs their own data.",
    targetSelector: '[data-tab="team"], [data-tab-id="team"]',
    applies: (c) => c.availableTabs.includes("team"),
  },
  {
    id: "basic-done",
    audience: "basic",
    title: "That's the basics! ✅",
    emoji: "🎉",
    body: "You now know the day-to-day features. You can finish here, or continue to the Advanced tour for technical features used by skilled operators (analytics, integrations, compliance, the founder admin console).",
  },
];

/* ---------------- ADVANCED ---------------- */

const ADVANCED_INTRO: TutorialStep[] = [
  {
    id: "adv-intro",
    audience: "advanced",
    title: "Advanced Tour 🔧",
    emoji: "🛠️",
    body: "This part covers the day-to-day features (as a recap) plus the technical tools used by skilled operators: accountants, IT/admins and multi-station owners. Use Next to move through, Skip to stop, or Remind me later.",
  },
];

const ADVANCED_TAB_STEPS: TutorialStep[] = [
  {
    id: "adv-livetransaction",
    audience: "advanced",
    title: "Live Transaction — real-time monitoring",
    emoji: "⚡",
    body: "Watch payments and sales arrive in real time. Useful during busy hours to catch issues instantly across all pumps.",
    targetSelector:
      '[data-tab="livetransaction"], [data-tab-id="livetransaction"]',
    applies: (c) => c.availableTabs.includes("livetransaction"),
  },
  {
    id: "adv-analytics",
    audience: "advanced",
    title: "Analytics — predictions & business intelligence",
    emoji: "🧠",
    body: "Trends, forecasting and business intelligence over your sales and fuel data. Spot slow days, best-selling products, and predict demand.",
    targetSelector: '[data-tab="analytics"], [data-tab-id="analytics"]',
    applies: (c) =>
      c.featureFlags.analytics && c.availableTabs.includes("analytics"),
  },
  {
    id: "adv-audit",
    audience: "advanced",
    title: "Audit Trail — compliance log",
    emoji: "🔍",
    body: "Complete, tamper-evident activity log of every change. Required for compliance and dispute resolution.",
    targetSelector: '[data-tab="audit"], [data-tab-id="audit"]',
    applies: (c) => c.featureFlags.audit && c.availableTabs.includes("audit"),
  },
  {
    id: "adv-fuelsalesreport",
    audience: "advanced",
    title: "Fuel Sales Report — monthly reporting",
    emoji: "🗓️",
    body: "Generate monthly fuel sales reports for tax authorities and management. Pre-formatted for KRA/eTIMS where applicable.",
    targetSelector:
      '[data-tab="fuelsalesreport"], [data-tab-id="fuelsalesreport"]',
    applies: (c) => c.availableTabs.includes("fuelsalesreport"),
  },
  {
    id: "adv-fueltypes",
    audience: "advanced",
    title: "Fuel Type Manager — configure your fuels",
    emoji: "🛢️",
    body: "Define fuel types, tanks, pumps and prices. Skilled operators use this to keep the fuel ledger accurate.",
    targetSelector: '[data-tab="fueltypes"], [data-tab-id="fueltypes"]',
    applies: (c) =>
      c.featureFlags.fueltypes && c.availableTabs.includes("fueltypes"),
  },
  {
    id: "adv-pumpmapping",
    audience: "advanced",
    title: "Pump Mapping V1 — AI ledger parsing",
    emoji: "🤖",
    body: "AI-powered parsing of pump ledgers and receipts into structured sales. Saves hours of manual entry.",
    targetSelector: '[data-tab="pumpmapping"], [data-tab-id="pumpmapping"]',
    applies: (c) => c.availableTabs.includes("pumpmapping"),
  },
  {
    id: "adv-suppliers",
    audience: "advanced",
    title: "Supplier Management — POs & purchases",
    emoji: "🏭",
    body: "Manage fuel suppliers, raise purchase orders, and record purchases. Tracks cost price per supplier for margin analysis.",
    targetSelector: '[data-tab="suppliers"], [data-tab-id="suppliers"]',
    applies: (c) =>
      c.featureFlags.suppliers && c.availableTabs.includes("suppliers"),
  },
  {
    id: "adv-maintenance",
    audience: "advanced",
    title: "Maintenance — equipment servicing",
    emoji: "🔧",
    body: "Schedule and track equipment maintenance and servicing (pumps, generators, tanks). Avoid costly downtime.",
    targetSelector: '[data-tab="maintenance"], [data-tab-id="maintenance"]',
    applies: (c) =>
      c.featureFlags.maintenance && c.availableTabs.includes("maintenance"),
  },
  {
    id: "adv-expenses",
    audience: "advanced",
    title: "Expenses — track & approve",
    emoji: "💸",
    body: "Record operational expenses and run approvals. Accountants reconcile expenses against sales here.",
    targetSelector: '[data-tab="expenses"], [data-tab-id="expenses"]',
    applies: (c) =>
      c.featureFlags.expenses && c.availableTabs.includes("expenses"),
  },
  {
    id: "adv-delivery",
    audience: "advanced",
    title: "Delivery Tracker — fuel to customers",
    emoji: "🚚",
    body: "Track fuel deliveries to your bulk customers (distance, volume, status). For stations that also distribute.",
    targetSelector: '[data-tab="delivery"], [data-tab-id="delivery"]',
    applies: (c) => c.availableTabs.includes("delivery"),
  },
  {
    id: "adv-documents",
    audience: "advanced",
    title: "Document Center — smart documents",
    emoji: "📁",
    body: "Upload, organize and convert documents (invoices, contracts, permits). Per-station isolation and auto-sort.",
    targetSelector: '[data-tab="documents"], [data-tab-id="documents"]',
    applies: (c) =>
      c.featureFlags.documents && c.availableTabs.includes("documents"),
  },
  {
    id: "adv-integration",
    audience: "advanced",
    title: "Integration Hub — connect external services",
    emoji: "🔌",
    body: "Connect accounting, POS hardware, payment providers and more. Skilled operators configure webhooks and API keys here.",
    targetSelector: '[data-tab="integration"], [data-tab-id="integration"]',
    applies: (c) =>
      c.featureFlags.integrations && c.availableTabs.includes("integration"),
  },
  {
    id: "adv-regional",
    audience: "advanced",
    title: "Compliance — regional tax & regulations",
    emoji: "⚖️",
    body: "Country-specific compliance: KRA/eTIMS (Kenya), EFD (Tanzania/Uganda), ETR, VAT reporting. Adapts to your detected country.",
    targetSelector: '[data-tab="regional"], [data-tab-id="regional"]',
    applies: (c) =>
      c.featureFlags.compliance && c.availableTabs.includes("regional"),
  },
  {
    id: "adv-communication",
    audience: "advanced",
    title: "Communication — client relationships",
    emoji: "💬",
    body: "CRM and messaging (WhatsApp/SMS/email where enabled) to customers. Skilled operators run campaigns from here.",
    targetSelector: '[data-tab="communication"], [data-tab-id="communication"]',
    applies: (c) => c.availableTabs.includes("communication"),
  },
  {
    id: "adv-news",
    audience: "advanced",
    title: "News — industry & price updates",
    emoji: "📰",
    body: "Fuel industry news, regulations, and price-change alerts for your region.",
    targetSelector: '[data-tab="news"], [data-tab-id="news"]',
    applies: (c) => c.availableTabs.includes("news"),
  },
];

const ADVANCED_FOUNDER_STEPS: TutorialStep[] = [
  {
    id: "adv-founder-intro",
    audience: "advanced",
    title: "Founder / Admin Console — the technical control center",
    emoji: "👑",
    body: "The Admin button (top-right, crown icon) opens the Founder Console: 50+ technical sections for security, billing, developer tools, webhooks, feature flags, schema, backups and more. This is where skilled operators and IT admins configure the whole platform.",
    targetSelector:
      'a[href*="/founder"], button[aria-label*="Admin"], [data-tutorial="founder"]',
    applies: (c) => c.featureFlags.founderAccess,
  },
  {
    id: "adv-founder-security",
    audience: "advanced",
    title: "Security & Access Control",
    emoji: "🔐",
    body: "Manage API keys, secrets, CORS, role matrix, blocklists, session inspector and audit logs. For IT admins hardening the deployment.",
    applies: (c) =>
      c.founderSections.includes("SecuritySection") ||
      c.founderSections.includes("RoleMatrixSection"),
  },
  {
    id: "adv-founder-billing",
    audience: "advanced",
    title: "Billing & Subscriptions",
    emoji: "💳",
    body: "Pricing manager, subscription dashboard, coupons, payouts, trial analytics and payment methods. For operators running SaaS billing.",
    applies: (c) =>
      c.founderSections.includes("PricingManagerSection") ||
      c.founderSections.includes("SubscriptionDashboardSection"),
  },
  {
    id: "adv-founder-devtools",
    audience: "advanced",
    title: "Developer Tools",
    emoji: "👨‍💻",
    body: "Developer Control Center, database query, schema visualizer, migrations, env vars, feature flags, command palette, log streams and error tracker. For engineers maintaining the platform.",
    applies: (c) =>
      c.founderSections.includes("DeveloperControlCenterSection") ||
      c.founderSections.includes("DatabaseQuerySection"),
  },
  {
    id: "adv-founder-ops",
    audience: "advanced",
    title: "Ops & Reliability",
    emoji: "🩺",
    body: "System health, health checks, performance, cache management, scheduled jobs, task queue, maintenance windows and backups. For keeping the platform running smoothly.",
    applies: (c) =>
      c.founderSections.includes("SystemHealthManagerSection") ||
      c.founderSections.includes("PerformanceSection"),
  },
  {
    id: "adv-founder-extensibility",
    audience: "advanced",
    title: "Extensibility — webhooks & integrations",
    emoji: "🔗",
    body: "Webhooks manager, webhook deliveries, API rate limits, announcements, experiments and localization. Extend the platform and automate workflows.",
    applies: (c) =>
      c.founderSections.includes("WebhooksManagerSection") ||
      c.founderSections.includes("ApiRateLimitsSection"),
  },
];

const ADVANCED_DONE: TutorialStep[] = [
  {
    id: "adv-done",
    audience: "advanced",
    title: "You're all set! 🚀",
    emoji: "✅",
    body: "You've seen both the day-to-day and the technical features. The tutorial won't show again automatically — replay it anytime from the Help menu in the header. Welcome aboard!",
    isFinal: true,
  },
];

/* ---------------- Builders ---------------- */

/**
 * Build the ordered step list for an audience, filtered by the live adaptive
 * context. Basic = intro + basic tabs + basic-done. Advanced = advanced intro
 * + basic tabs (recap) + advanced tabs + founder steps + advanced-done.
 */
export function buildTutorialSteps(
  audience: TutorialAudience,
  ctx: TutorialAdaptiveContext,
): TutorialStep[] {
  const keep = (s: TutorialStep) => (s.applies ? s.applies(ctx) : true);

  if (audience === "basic") {
    // BASIC_TAB_STEPS already ends with the "basic-done" summary step.
    return [...BASIC_INTRO, ...BASIC_TAB_STEPS.filter(keep)];
  }

  return [
    ...ADVANCED_INTRO,
    ...BASIC_TAB_STEPS.filter(keep), // recap of day-to-day
    ...ADVANCED_TAB_STEPS.filter(keep),
    ...ADVANCED_FOUNDER_STEPS.filter(keep),
    ...ADVANCED_DONE,
  ];
}
