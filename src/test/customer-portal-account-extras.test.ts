/**
 * The customer account page's second wave: invoices, payment channels and the
 * statement summary.
 *
 * The failure modes worth pinning are the ones that quietly give a customer
 * the wrong information: another customer's invoice on their page, a summary
 * that disagrees with the rows beneath it, or a paybill number the station
 * never configured. Each is asserted directly.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  buildCustomerPortalDoc,
  buildPaymentMethods,
  invoiceBelongsTo,
  PORTAL_INVOICE_LIMIT,
  PORTAL_TX_LIMIT,
} from "@/react-app/lib/customer-portal-service";

const account = {
  id: "acc-1",
  customerName: "Acme Logistics",
  balance: 12000,
  creditLimit: 50000,
  status: "active",
};

const base = {
  token: "abcDEF123456",
  account,
  transactions: [],
  station: { name: "Publican Energy" },
  currencySymbol: "$",
  expiresAt: "2027-01-01T00:00:00.000Z",
};

describe("invoice matching", () => {
  it("matches on the customer's name, ignoring case and padding", () => {
    expect(
      invoiceBelongsTo({ customerName: "  acme logistics " }, "Acme Logistics"),
    ).toBe(true);
    expect(
      invoiceBelongsTo(
        { customer: { name: "ACME LOGISTICS" } },
        "Acme Logistics",
      ),
    ).toBe(true);
  });

  it("does not match a different customer", () => {
    expect(
      invoiceBelongsTo({ customerName: "Other Ltd" }, "Acme Logistics"),
    ).toBe(false);
  });

  it("never matches an unnamed invoice, which would sweep in every blank one", () => {
    expect(invoiceBelongsTo({ customerName: "" }, "Acme Logistics")).toBe(
      false,
    );
    expect(invoiceBelongsTo({}, "Acme Logistics")).toBe(false);
    // …and an unnamed account cannot claim anything either.
    expect(invoiceBelongsTo({ customerName: "Acme" }, "")).toBe(false);
    expect(invoiceBelongsTo({ customerName: "" }, "")).toBe(false);
  });

  it("does not let the 'Customer' display fallback claim invoices billed to 'Customer'", () => {
    // An account with no name shows as "Customer", but that is a caption, not
    // an identity — invoices actually billed to "Customer" are other people's.
    const doc = buildCustomerPortalDoc({
      ...base,
      account: { ...account, customerName: "", name: "" },
      invoices: [
        { number: "INV-OTHER", customerName: "Customer", totalAmount: 999 },
      ],
    });
    expect(doc.customerName).toBe("Customer");
    expect(doc.invoices).toEqual([]);
  });
});

describe("invoices on the published document", () => {
  const invoices = [
    {
      number: "INV-2",
      customerName: "Acme Logistics",
      date: "2026-09-10",
      totalAmount: 500,
      status: "unpaid",
    },
    {
      number: "INV-1",
      customerName: "Acme Logistics",
      date: "2026-09-01",
      totalAmount: 250,
      status: "paid",
    },
    {
      number: "INV-X",
      customerName: "Someone Else",
      date: "2026-09-05",
      totalAmount: 99999,
      status: "unpaid",
    },
  ];

  it("publishes only this customer's invoices, newest first", () => {
    const doc = buildCustomerPortalDoc({ ...base, invoices });
    expect(doc.invoices.map((i) => i.number)).toEqual(["INV-2", "INV-1"]);
  });

  it("coerces a junk amount to 0 rather than publishing NaN", () => {
    const doc = buildCustomerPortalDoc({
      ...base,
      invoices: [
        { number: "INV-3", customerName: "Acme Logistics", totalAmount: NaN },
      ],
    });
    expect(doc.invoices[0].amount).toBe(0);
  });

  it("caps the list so a link cannot carry unbounded history", () => {
    const many = Array.from({ length: PORTAL_INVOICE_LIMIT + 10 }, (_, i) => ({
      number: `INV-${i}`,
      customerName: "Acme Logistics",
      date: `2026-09-${String((i % 28) + 1).padStart(2, "0")}`,
      totalAmount: 10,
      status: "unpaid",
    }));
    const doc = buildCustomerPortalDoc({ ...base, invoices: many });
    expect(doc.invoices).toHaveLength(PORTAL_INVOICE_LIMIT);
  });

  it("treats any status other than 'paid' as unpaid, so nothing looks settled by accident", () => {
    const doc = buildCustomerPortalDoc({
      ...base,
      invoices: [
        { number: "A", customerName: "Acme Logistics", status: "PARTIAL" },
        { number: "B", customerName: "Acme Logistics", status: "Paid" },
      ],
    });
    expect(doc.invoices.find((i) => i.number === "A")?.status).toBe("unpaid");
    expect(doc.invoices.find((i) => i.number === "B")?.status).toBe("paid");
  });
});

describe("payment channels", () => {
  it("offers an enabled M-PESA paybill with its shortcode", () => {
    expect(
      buildPaymentMethods({
        mpesa: {
          enabled: true,
          type: "paybill",
          shortcode: "522522",
          accountReference: "Acme",
        },
      }),
    ).toEqual([
      {
        kind: "paybill",
        label: "M-PESA Paybill",
        number: "522522",
        accountRef: "Acme",
      },
    ]);
  });

  it("labels a buy-goods shortcode as a till", () => {
    const [m] = buildPaymentMethods({
      mpesa: { enabled: true, type: "buy_goods", shortcode: "578590" },
    });
    expect(m.kind).toBe("till");
    expect(m.number).toBe("578590");
  });

  it("ignores a disabled gateway, so a half-configured one is never a way to pay", () => {
    expect(
      buildPaymentMethods({
        mpesa: { enabled: false, shortcode: "522522" },
        kopokopo: { enabled: false, tillNumber: "111" },
      }),
    ).toEqual([]);
  });

  it("ignores an enabled gateway with no number", () => {
    expect(
      buildPaymentMethods({ mpesa: { enabled: true, shortcode: "  " } }),
    ).toEqual([]);
  });

  it("drops a channel with no number from the published document", () => {
    const doc = buildCustomerPortalDoc({
      ...base,
      paymentMethods: [
        { kind: "paybill", label: "M-PESA", number: "" },
        { kind: "till", label: "Kopo Kopo", number: " 4242 " },
      ],
    });
    expect(doc.paymentMethods).toEqual([
      {
        kind: "till",
        label: "Kopo Kopo",
        number: "4242",
        accountRef: undefined,
      },
    ]);
  });

  it("publishes no channels when the station configured none", () => {
    expect(buildCustomerPortalDoc(base).paymentMethods).toEqual([]);
  });
});

describe("reaching the account page from the collections surfaces", () => {
  // Reading source is the right tool for wiring: the assertion is "this tab
  // offers the action and routes it to the portal", which a unit test that
  // re-implements the handler could not prove.
  const readSrc = (p: string) => readFileSync(p, "utf8");

  it("offers it on each debt-reminder client row", () => {
    const src = readSrc("src/react-app/components/DebtReminder.tsx");
    // The rendered label, not merely the phrase somewhere in the file.
    expect(src).toMatch(/>\s*Account Page\s*</);
    expect(src).toContain('navigateToTab("credit"');
    expect(src).toContain('subTab: "portal"');
  });

  it("offers it on each aged-debt row, which is where it is needed most", () => {
    const src = readSrc("src/react-app/components/CreditAgingReport.tsx");
    expect(src).toContain('subTab: "portal"');
    expect(src).toContain("navigateToTab");
  });

  it("resolves the linked customer to an account rather than trusting the name", () => {
    const src = readSrc("src/react-app/components/CreditManagement.tsx");
    // A sub-tab payload is navigation; it must not fall through into the
    // new-account prefill, which would open the add form instead.
    expect(src).toContain('p.subTab === "portal"');
    expect(src).toContain("accountsRef.current.find");
    // And it must say so when there is no matching account, instead of opening
    // an empty portal that looks broken.
    expect(src).toContain("No credit account found");
  });

  it("reads accounts through the ref, since the effect subscribes once", () => {
    const src = readSrc("src/react-app/components/CreditManagement.tsx");
    const start = src.indexOf('onTabPayload("credit"');
    // Bound the slice to the handler: the effect is registered with `[]`, so
    // anything past its closing `}, []);` belongs to another function.
    const end = src.indexOf("}, []);", start);
    const handler = src.slice(start, end === -1 ? undefined : end);
    // Reading `accounts` directly here would capture the mount-time value,
    // which is always empty — the link would then never resolve.
    expect(handler).not.toMatch(/accounts\.find|accounts\[/);
    expect(handler).toContain("accountsRef.current");
  });
});

describe("statement summary", () => {
  const transactions = [
    {
      id: "t1",
      accountId: "acc-1",
      type: "purchase",
      amount: 5000,
      date: "2026-09-01T10:00:00.000Z",
    },
    {
      id: "t2",
      accountId: "acc-1",
      type: "payment",
      amount: 2000,
      date: "2026-09-10T10:00:00.000Z",
    },
    {
      id: "t3",
      accountId: "acc-1",
      type: "purchase",
      amount: 1000,
      date: "2026-09-05T10:00:00.000Z",
    },
  ];

  it("totals exactly the rows it publishes, so figures and list agree", () => {
    const doc = buildCustomerPortalDoc({ ...base, transactions });
    expect(doc.statement).toEqual({
      from: doc.transactions[doc.transactions.length - 1].date,
      to: doc.transactions[0].date,
      purchases: 6000,
      payments: 2000,
      net: 4000,
      count: 3,
    });
    // The count matches the rendered list, not some wider window.
    expect(doc.statement?.count).toBe(doc.transactions.length);
  });

  it("reports no summary at all when there is nothing to summarise", () => {
    expect(buildCustomerPortalDoc(base).statement).toBeNull();
  });

  it("counts rows it could not classify as other without inventing a direction", () => {
    const doc = buildCustomerPortalDoc({
      ...base,
      transactions: [
        {
          id: "t1",
          accountId: "acc-1",
          type: "adjustment",
          amount: 300,
          date: "2026-09-01T10:00:00.000Z",
        },
      ],
    });
    expect(doc.transactions[0].type).toBe("other");
    expect(doc.statement?.payments).toBe(0);
    expect(doc.statement?.purchases).toBe(0);
    expect(doc.statement?.net).toBe(300);
  });

  it("stays consistent when the list is capped", () => {
    const many = Array.from({ length: PORTAL_TX_LIMIT + 5 }, (_, i) => ({
      id: `t${i}`,
      accountId: "acc-1",
      type: "purchase",
      amount: 100,
      date: `2026-09-${String((i % 28) + 1).padStart(2, "0")}T10:00:00.000Z`,
    }));
    const doc = buildCustomerPortalDoc({ ...base, transactions: many });
    expect(doc.transactions).toHaveLength(PORTAL_TX_LIMIT);
    expect(doc.statement?.count).toBe(PORTAL_TX_LIMIT);
    expect(doc.statement?.purchases).toBe(PORTAL_TX_LIMIT * 100);
  });
});
