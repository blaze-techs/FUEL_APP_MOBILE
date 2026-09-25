/**
 * CustomerAccountLinkPanel — the one place that issues and manages a customer
 * account link (the second mini site).
 *
 * Extracted so the Credit Accounts list, the Customer Portal and the Statements
 * view all drive the SAME create/copy/share/preview/revoke logic instead of
 * three drifting copies of it. A link's lifecycle has real consequences — it
 * exposes a balance — so having exactly one implementation is the point.
 *
 * Purely presentational + calls the service; it holds no publishing rules of
 * its own.
 */

import { useCallback, useEffect, useState } from "react";
import {
  Copy,
  Share2,
  Link2,
  ExternalLink,
  Ban,
  Loader2,
  RefreshCw,
  Eye,
} from "lucide-react";
import {
  createCustomerPortalLink,
  listCustomerPortalLinks,
  revokeCustomerPortalLink,
  fetchCustomerPortalViewStats,
  customerPortalShareLine,
  customerPortalUrl,
  type CreditAccountInput,
  type CreditTransactionInput,
} from "@/react-app/lib/customer-portal-service";
import { toastSuccess, toastError } from "@/react-app/lib/toast";

export interface CustomerAccountLinkPanelProps {
  account: CreditAccountInput | null | undefined;
  transactions: CreditTransactionInput[];
  station?: { name?: string; phone?: string; email?: string };
  stationId?: string;
  currencySymbol: string;
  /** Compact variant for tight layouts. */
  compact?: boolean;
}

export default function CustomerAccountLinkPanel({
  account,
  transactions,
  station,
  stationId,
  currencySymbol,
  compact = false,
}: CustomerAccountLinkPanelProps) {
  const [busy, setBusy] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [activeCount, setActiveCount] = useState(0);
  // "Has the customer actually opened it?" — the one signal a link's owner
  // cannot otherwise get. Null while unknown, so a failure shows nothing
  // rather than a wrong "0 views".
  const [views, setViews] = useState<number | null>(null);

  const accountId = account?.id || "";
  const accountName = String(
    account?.customerName || account?.name || "Customer",
  );

  const refresh = useCallback(async () => {
    if (!accountId) {
      setToken(null);
      setActiveCount(0);
      setViews(null);
      return;
    }
    const all = await listCustomerPortalLinks({ accountId, stationId });
    const live = all.filter((l) => !l.expired && !l.revoked);
    setActiveCount(live.length);
    // Keep the currently-shown token if it is still live; otherwise adopt the
    // newest one so "Copy link" works without forcing a re-create.
    setToken((prev) =>
      prev && all.some((l) => l.token === prev)
        ? prev
        : (live[0]?.token ?? null),
    );
  }, [accountId, stationId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Fetch the counter for whichever token is on screen. Kept separate from
  // `refresh` because the counter is a convenience tile — a failure must not
  // affect the link controls.
  useEffect(() => {
    if (!token) {
      setViews(null);
      return;
    }
    let cancelled = false;
    (async () => {
      const stats = await fetchCustomerPortalViewStats(token);
      if (!cancelled) setViews(stats ? stats.views : null);
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (!account) return null;

  const create = async () => {
    setBusy(true);
    try {
      const created = await createCustomerPortalLink({
        account,
        transactions,
        station,
        stationId,
        currencySymbol,
      });
      if (!created) {
        toastError("Could not create the account link. Try again.");
        return;
      }
      setToken(created.token);
      await refresh();
      toastSuccess("Account link created — share it with the customer.");
    } finally {
      setBusy(false);
    }
  };

  const shareText = () =>
    customerPortalShareLine(token, `${accountName}, view your account:`);

  const copy = async () => {
    const line = shareText();
    if (!line) {
      toastError("Create an account link first.");
      return;
    }
    try {
      await navigator.clipboard.writeText(line);
      toastSuccess("Account link copied.");
    } catch {
      toastError("Could not copy — select the link manually.");
    }
  };

  const whatsapp = () => {
    const line = shareText();
    if (!line) {
      toastError("Create an account link first.");
      return;
    }
    const digits = String(account.phone || "").replace(/\D/g, "");
    // No number → the contact-picker form, which still opens WhatsApp.
    window.open(
      `https://wa.me/${digits}?text=${encodeURIComponent(line)}`,
      "_blank",
      "noopener",
    );
  };

  const revoke = async () => {
    if (!token) return;
    const ok = await revokeCustomerPortalLink(token, stationId);
    if (!ok) {
      toastError("Could not revoke the link.");
      return;
    }
    toastSuccess("Account link revoked — it no longer opens.");
    setToken(null);
    await refresh();
  };

  return (
    <div
      className={`rounded border border-emerald-200 dark:border-emerald-800 bg-emerald-50/60 dark:bg-emerald-900/20 ${
        compact ? "p-3" : "p-4"
      } space-y-3`}
    >
      <div className="flex items-start gap-2">
        <Link2 className="w-4 h-4 text-emerald-600 mt-0.5 shrink-0" />
        <div className="min-w-0">
          <p className="font-semibold text-sm text-gray-900 dark:text-white">
            Customer account page
          </p>
          <p className="text-xs text-gray-600 dark:text-gray-400">
            A private page {accountName} can open to see their balance and
            activity. The link is unguessable, expires, and can be revoked.
          </p>
        </div>
      </div>

      {token ? (
        <>
          <div className="rounded bg-white dark:bg-black/20 border border-emerald-200 dark:border-emerald-800 px-3 py-2">
            <p className="text-[11px] text-gray-500 break-all font-mono">
              {customerPortalUrl(token)}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button onClick={copy} className="btn btn-secondary !p-2 !text-xs">
              <Copy className="w-3 h-3" /> Copy link
            </button>
            <button
              onClick={whatsapp}
              className="btn btn-secondary !p-2 !text-xs"
            >
              <Share2 className="w-3 h-3" /> WhatsApp
            </button>
            <button
              onClick={() =>
                window.open(`/account/${token}`, "_blank", "noopener")
              }
              className="btn btn-secondary !p-2 !text-xs"
            >
              <ExternalLink className="w-3 h-3" /> Preview
            </button>
            <button
              onClick={create}
              disabled={busy}
              className="btn btn-secondary !p-2 !text-xs"
              title="Issue a new link (use after a leak or when the old one expires)"
            >
              {busy ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <RefreshCw className="w-3 h-3" />
              )}{" "}
              New link
            </button>
            <button
              onClick={revoke}
              className="btn btn-secondary !p-2 !text-xs text-red-600"
            >
              <Ban className="w-3 h-3" /> Revoke
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-gray-500">
            <span>
              {activeCount} active link{activeCount === 1 ? "" : "s"} for this
              customer.
            </span>
            {views !== null && (
              <span className="inline-flex items-center gap-1">
                <Eye className="w-3 h-3" />
                {views === 0
                  ? "Not opened yet"
                  : `${views} view${views === 1 ? "" : "s"}`}
              </span>
            )}
          </div>
        </>
      ) : (
        <button
          onClick={create}
          disabled={busy}
          className="btn btn-primary !p-2 !text-xs"
        >
          {busy ? (
            <Loader2 className="w-3 h-3 animate-spin" />
          ) : (
            <Link2 className="w-3 h-3" />
          )}{" "}
          Create account link
        </button>
      )}
    </div>
  );
}
