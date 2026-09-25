/**
 * CustomerAccount — the PUBLIC, no-login account page for ONE customer.
 *
 * This is the second mini site, and it is deliberately not the station page:
 * the station page (`/site/<slug>`) advertises the business to anyone, while
 * this shows one named customer their own balance and recent activity. It is
 * reached through an unguessable, expiring, revocable link the owner sends.
 *
 * Render rules that keep it honest and private:
 *  • The document is read through the SERVER resolver, never the public bucket,
 *    so expiry and revocation cannot be bypassed by fetching storage directly.
 *  • Always `noindex` — a private balance must never appear in a search result.
 *  • Figures shown are the snapshot the owner issued, stamped with an "as at"
 *    time, so nothing reads as a live balance.
 *  • Missing data is omitted, never substituted (no invented limit or balance).
 *  • No customer-identifying detail is logged or put in the URL beyond the token.
 */

import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router";
import {
  Loader2,
  AlertTriangle,
  Wallet,
  CalendarClock,
  Phone,
  Mail,
  Copy,
  Check,
  ArrowDownLeft,
  ArrowUpRight,
  CircleDot,
  FileText,
  MessageCircle,
} from "lucide-react";
import {
  fetchCustomerPortalDoc,
  recordCustomerPortalView,
  customerPortalUrl,
  type CustomerPortalDocument,
} from "@/react-app/lib/customer-portal-service";
import { SUPPORT_EMAIL } from "@/react-app/config/support-contact";

type LoadState = "loading" | "missing" | "ready";

function money(symbol: string, n: number): string {
  const value = Number.isFinite(n) ? n : 0;
  return `${symbol}${value.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function shortDate(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "—";
  return new Date(t).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/** Force noindex for this page, always — it is private data. */
function useAlwaysNoindex() {
  useEffect(() => {
    const el = document.head.querySelector<HTMLMetaElement>(
      'meta[name="robots"]',
    );
    if (el) el.setAttribute("content", "noindex, nofollow");
    else {
      const meta = document.createElement("meta");
      meta.setAttribute("name", "robots");
      meta.setAttribute("content", "noindex, nofollow");
      document.head.appendChild(meta);
    }
    const canonical = document.head.querySelector('link[rel="canonical"]');
    canonical?.remove();
  }, []);
}

export default function CustomerAccount() {
  const { token = "" } = useParams();
  const [state, setState] = useState<LoadState>("loading");
  const [doc, setDoc] = useState<CustomerPortalDocument | null>(null);
  const [copied, setCopied] = useState(false);
  // Guards the view counter against React's double-invoked effects in dev,
  // which would otherwise record two views for one visit.
  const countedRef = useRef(false);

  useAlwaysNoindex();

  useEffect(() => {
    let cancelled = false;
    setState("loading");
    setDoc(null);
    (async () => {
      const found = await fetchCustomerPortalDoc(token);
      if (cancelled) return;
      if (!found) {
        // A revoked and an expired link are both "not available"; we do not
        // distinguish an unknown token from a dead one beyond the generic body.
        setState("missing");
        return;
      }
      setDoc(found);
      setState("ready");

      // Best-effort, once per page load. Never blocks rendering.
      if (!countedRef.current) {
        countedRef.current = true;
        void recordCustomerPortalView(token);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  useEffect(() => {
    document.title = doc
      ? `Account — ${doc.stationName || "Station"}`
      : "Account link — FuelPro";
  }, [doc]);

  if (state === "loading") {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-[#0a0e17] flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-6 h-6 animate-spin mx-auto text-gray-400" />
          <p className="mt-3 text-sm text-gray-500 dark:text-gray-400">
            Loading your account…
          </p>
        </div>
      </div>
    );
  }

  if (state === "missing" || !doc) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-[#0a0e17] flex items-center justify-center p-6">
        <div className="max-w-md w-full text-center">
          <AlertTriangle className="w-8 h-8 mx-auto text-amber-500" />
          <h1 className="mt-4 text-lg font-semibold text-gray-900 dark:text-white">
            This account link is not available
          </h1>
          <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
            The link may have expired, or the station may have replaced it. Ask
            the station to send you a new one.
          </p>
          <p className="mt-3 text-xs text-gray-500 dark:text-gray-500">
            {SUPPORT_EMAIL}
          </p>
        </div>
      </div>
    );
  }

  const hasLimit = typeof doc.utilisation === "number";
  const utilisation = hasLimit ? Math.max(0, doc.utilisation as number) : 0;
  const barWidth = hasLimit ? Math.min(100, utilisation) : 0;
  const overLimit = hasLimit && doc.balance > doc.creditLimit;
  // Count only what is shown; `invoices` may be absent on links issued before
  // this field existed, so it is treated as empty rather than undefined.
  const outstandingCount = (doc.invoices || []).filter(
    (inv) => inv.status !== "paid",
  ).length;

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-[#0a0e17]">
      <div className="max-w-2xl mx-auto p-4 sm:p-6 space-y-5">
        {/* Header: who this is from */}
        <header className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">
              Account statement
            </p>
            <h1 className="text-xl font-bold text-gray-900 dark:text-white truncate">
              {doc.stationName || "Your station"}
            </h1>
            <p className="text-sm text-gray-600 dark:text-gray-400 truncate">
              {doc.customerName}
            </p>
          </div>
          <div className="flex gap-2 shrink-0">
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard
                  ?.writeText(customerPortalUrl(doc.token))
                  .then(() => {
                    setCopied(true);
                    setTimeout(() => setCopied(false), 2000);
                  })
                  .catch(() => {});
              }}
              className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-gray-200 dark:border-white/10 bg-white dark:bg-white/5 text-sm text-gray-700 dark:text-gray-300"
              aria-label="Copy account link"
            >
              {copied ? (
                <Check className="w-4 h-4 text-emerald-500" />
              ) : (
                <Copy className="w-4 h-4" />
              )}
            </button>
          </div>
        </header>

        {/* Balance card */}
        <section className="rounded-xl border border-gray-200 dark:border-white/10 bg-white dark:bg-white/5 p-5">
          <div className="flex items-center gap-2 text-gray-500 dark:text-gray-400">
            <Wallet className="w-4 h-4" />
            <span className="text-xs uppercase tracking-wide">
              Outstanding balance
            </span>
          </div>
          <p className="mt-1 text-3xl font-bold text-gray-900 dark:text-white tabular-nums">
            {money(doc.currencySymbol, doc.balance)}
          </p>

          {hasLimit ? (
            <div className="mt-4">
              <div className="flex items-center justify-between text-xs text-gray-600 dark:text-gray-400">
                <span>Limit {money(doc.currencySymbol, doc.creditLimit)}</span>
                <span className={overLimit ? "text-red-600" : ""}>
                  {utilisation}% used
                </span>
              </div>
              <div className="mt-1.5 h-2 rounded-full bg-gray-100 dark:bg-white/10 overflow-hidden">
                <div
                  className={`h-full rounded-full ${overLimit ? "bg-red-500" : "bg-emerald-500"}`}
                  style={{ width: `${barWidth}%` }}
                />
              </div>
              {overLimit && (
                <p className="mt-2 text-xs text-red-600 dark:text-red-400">
                  Balance exceeds the agreed limit by{" "}
                  {money(doc.currencySymbol, doc.balance - doc.creditLimit)}.
                </p>
              )}
            </div>
          ) : (
            <p className="mt-2 text-xs text-gray-500 dark:text-gray-500">
              No credit limit is set on this account.
            </p>
          )}

          <p className="mt-3 flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-500">
            <CalendarClock className="w-3.5 h-3.5" />
            As at {new Date(doc.asAt).toLocaleString()} ·{" "}
            <CircleDot className="w-3 h-3" /> {doc.status}
          </p>
        </section>

        {/* Statement summary — totals over exactly the rows listed below, so
            the figures and the list can never disagree. */}
        {doc.statement && (
          <section className="rounded-xl border border-gray-200 dark:border-white/10 bg-white dark:bg-white/5 p-5">
            <div className="flex items-center gap-2 text-gray-500 dark:text-gray-400">
              <FileText className="w-4 h-4" />
              <span className="text-xs uppercase tracking-wide">
                Statement summary
              </span>
            </div>
            <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Purchases
                </p>
                <p className="text-sm font-semibold text-gray-900 dark:text-white tabular-nums">
                  {money(doc.currencySymbol, doc.statement.purchases)}
                </p>
              </div>
              <div>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Payments
                </p>
                <p className="text-sm font-semibold text-emerald-600 dark:text-emerald-400 tabular-nums">
                  {money(doc.currencySymbol, doc.statement.payments)}
                </p>
              </div>
              <div>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Entries
                </p>
                <p className="text-sm font-semibold text-gray-900 dark:text-white tabular-nums">
                  {doc.statement.count}
                </p>
              </div>
              <div>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Net movement
                </p>
                <p className="text-sm font-semibold text-gray-900 dark:text-white tabular-nums">
                  {money(doc.currencySymbol, doc.statement.net)}
                </p>
              </div>
            </div>
            {doc.statement.from && (
              <p className="mt-3 text-xs text-gray-500 dark:text-gray-500">
                Covering {shortDate(doc.statement.from)} –{" "}
                {shortDate(doc.statement.to)}
              </p>
            )}
          </section>
        )}

        {/* Invoices — which ones are outstanding, and for how much. */}
        {doc.invoices.length > 0 && (
          <section className="rounded-xl border border-gray-200 dark:border-white/10 bg-white dark:bg-white/5">
            <div className="px-5 py-3 border-b border-gray-100 dark:border-white/10">
              <h2 className="text-sm font-semibold text-gray-900 dark:text-white">
                Invoices
              </h2>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {outstandingCount > 0
                  ? `${outstandingCount} awaiting payment`
                  : "All settled"}
              </p>
            </div>
            <ul className="divide-y divide-gray-100 dark:divide-white/10">
              {doc.invoices.map((inv) => {
                const paid = inv.status === "paid";
                return (
                  <li
                    key={inv.number}
                    className="px-5 py-3 flex items-center gap-3"
                  >
                    <span className="min-w-0 flex-1">
                      <p className="text-sm text-gray-900 dark:text-white truncate">
                        {inv.number || "Invoice"}
                      </p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        {shortDate(inv.date)}
                      </p>
                    </span>
                    <span
                      className={`text-[11px] px-2 py-0.5 rounded-full ${
                        paid
                          ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300"
                          : "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300"
                      }`}
                    >
                      {paid ? "Paid" : "Unpaid"}
                    </span>
                    <span className="text-sm font-medium text-gray-900 dark:text-white tabular-nums">
                      {money(doc.currencySymbol, inv.amount)}
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {/* Recent activity */}
        <section className="rounded-xl border border-gray-200 dark:border-white/10 bg-white dark:bg-white/5">
          <div className="px-5 py-3 border-b border-gray-100 dark:border-white/10">
            <h2 className="text-sm font-semibold text-gray-900 dark:text-white">
              Recent activity
            </h2>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Your last {doc.transactions.length}{" "}
              {doc.transactions.length === 1 ? "entry" : "entries"}
            </p>
          </div>
          {doc.transactions.length === 0 ? (
            <p className="px-5 py-6 text-sm text-gray-500 dark:text-gray-400">
              No activity recorded on this account yet.
            </p>
          ) : (
            <ul className="divide-y divide-gray-100 dark:divide-white/10">
              {doc.transactions.map((t, i) => {
                const isPayment = t.type === "payment";
                return (
                  <li
                    key={`${t.date}-${i}`}
                    className="px-5 py-3 flex items-center gap-3"
                  >
                    <span
                      className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
                        isPayment
                          ? "bg-emerald-100 dark:bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                          : "bg-gray-100 dark:bg-white/10 text-gray-600 dark:text-gray-300"
                      }`}
                    >
                      {isPayment ? (
                        <ArrowDownLeft className="w-4 h-4" />
                      ) : (
                        <ArrowUpRight className="w-4 h-4" />
                      )}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-gray-900 dark:text-white truncate">
                        {t.description || (isPayment ? "Payment" : "Purchase")}
                      </p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        {shortDate(t.date)}
                      </p>
                    </div>
                    <span
                      className={`text-sm font-medium tabular-nums ${isPayment ? "text-emerald-600 dark:text-emerald-400" : "text-gray-900 dark:text-white"}`}
                    >
                      {isPayment ? "−" : "+"}
                      {money(doc.currencySymbol, Math.abs(t.amount))}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* Payment instructions + channels + contact (only what the station
            configured — a wrong paybill number sends money to a stranger). */}
        {(doc.paymentInstructions ||
          doc.paymentMethods.length > 0 ||
          doc.stationPhone ||
          doc.stationEmail) && (
          <section className="rounded-xl border border-gray-200 dark:border-white/10 bg-white dark:bg-white/5 p-5 space-y-3">
            <h2 className="text-sm font-semibold text-gray-900 dark:text-white">
              Settle your account
            </h2>
            {doc.paymentInstructions && (
              <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-line">
                {doc.paymentInstructions}
              </p>
            )}
            {doc.paymentMethods.length > 0 && (
              <ul className="space-y-2">
                {doc.paymentMethods.map((m) => (
                  <li
                    key={`${m.kind}-${m.number}`}
                    className="rounded-lg border border-gray-200 dark:border-white/10 px-3 py-2"
                  >
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      {m.label}
                    </p>
                    <p className="text-sm font-semibold text-gray-900 dark:text-white font-mono">
                      {m.number}
                    </p>
                    {m.accountRef && (
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        Account: {m.accountRef}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            )}
            <div className="flex flex-wrap gap-2">
              {doc.stationPhone && (
                <a
                  href={`tel:${doc.stationPhone.replace(/[^\d+]/g, "")}`}
                  className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg bg-emerald-600 text-white text-sm"
                  aria-label="Call the station"
                >
                  <Phone className="w-4 h-4" /> Call station
                </a>
              )}
              {doc.stationEmail && (
                <a
                  href={`mailto:${doc.stationEmail}?subject=${encodeURIComponent(
                    `Account query — ${doc.customerName}${doc.accountId ? ` (${doc.accountId})` : ""}`,
                  )}&body=${encodeURIComponent(
                    `Hello ${doc.stationName || "there"},\n\nI have a query about my account.\n\nAccount: ${doc.accountId || "—"}\nBalance shown: ${money(doc.currencySymbol, doc.balance)}\n\nMy question:\n`,
                  )}`}
                  className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-gray-200 dark:border-white/10 text-sm text-gray-700 dark:text-gray-300"
                  aria-label="Email the station about this account"
                >
                  <Mail className="w-4 h-4" /> Message station
                </a>
              )}
              {/* WhatsApp uses the station's configured number only — no
                  guessed country code, which is how wrong numbers happen. */}
              {doc.stationPhone && (
                <a
                  href={`https://wa.me/${doc.stationPhone.replace(/[^\d]/g, "")}?text=${encodeURIComponent(
                    `Hello ${doc.stationName || "there"}, I have a query about my account ${doc.accountId || ""} (balance ${money(doc.currencySymbol, doc.balance)}).`,
                  )}`}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-gray-200 dark:border-white/10 text-sm text-gray-700 dark:text-gray-300"
                  aria-label="Message the station on WhatsApp"
                >
                  <MessageCircle className="w-4 h-4" /> WhatsApp
                </a>
              )}
            </div>
          </section>
        )}

        <footer className="text-center text-xs text-gray-500 dark:text-gray-500 pb-6">
          <p>
            This statement was issued by {doc.stationName || "your station"} and
            is valid until {shortDate(doc.expiresAt)}.
          </p>
          <p className="mt-1">
            Figures are a snapshot, not a live balance. Questions?{" "}
            {SUPPORT_EMAIL}
          </p>
        </footer>
      </div>
    </div>
  );
}
