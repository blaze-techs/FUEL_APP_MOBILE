import { useEffect, useMemo, useState } from "react";
import {
  Ban,
  Copy,
  ExternalLink,
  Link2,
  Loader2,
  MessageCircle,
  RefreshCw,
} from "lucide-react";
import { useStations } from "@/react-app/context/StationContext";
import { useFuel } from "@/react-app/context/FuelContext";
import { useCloudKV } from "@/react-app/hooks/useCloudKV";
import { resolveCurrencySymbol } from "@/react-app/lib/currency";
import { CLOUD_KEYS, type FleetCard, type FleetUsage } from "@/react-app/lib/forecourt-features";
import { loadMiniSiteConfig, type MiniSiteConfig } from "@/react-app/lib/mini-site-service";
import {
  EXTERNAL_PORTAL_LABELS,
  createExternalMiniSiteLink,
  externalMiniSiteShareLine,
  externalMiniSiteUrl,
  listExternalMiniSiteLinks,
  revokeExternalMiniSiteLink,
  type ExternalMiniSiteKind,
  type ExternalMiniSiteLinkRecord,
  type ExternalMiniSiteSection,
} from "@/react-app/lib/external-mini-site-service";
import { toastError, toastSuccess } from "@/react-app/lib/toast";

type Account = {
  id: string;
  customerName?: string;
  name?: string;
  balance?: number;
  creditLimit?: number;
  status?: string;
  phone?: string;
  email?: string;
  paymentInstructions?: string;
};

type CreditTransaction = {
  id: string;
  accountId: string;
  type?: string;
  amount?: number;
  description?: string;
  date?: string;
  createdAt?: string;
};

type Supplier = {
  id: string;
  name: string;
  phone?: string;
  email?: string;
  contactPerson?: string;
  status?: string;
  creditLimit?: number;
  currentBalance?: number;
  fuelTypes?: string[];
  notes?: string;
};

type PurchaseOrder = {
  id: string;
  supplierId?: string;
  supplierName?: string;
  date?: string;
  createdAt?: string;
  liters?: number;
  pricePerLiter?: number;
  amount?: number;
  totalAmount?: number;
  status?: string;
  [key: string]: unknown;
};

type LoyaltyCustomer = {
  id: string;
  name?: string;
  phone?: string;
  email?: string;
  loyaltyPoints?: number;
  tier?: string;
  totalSpent?: number;
};

type CommContact = {
  id: string;
  name?: string;
  phone?: string;
  email?: string;
  company?: string;
  tags?: string[];
  balance?: number;
  lastContact?: string;
};

type CommMessage = {
  id: string;
  contactId: string;
  type?: string;
  content?: string;
  subject?: string;
  status?: string;
  timestamp?: string;
  sentBy?: string;
};

type Complaint = {
  id: string;
  date?: string;
  customer?: string;
  subject?: string;
  severity?: string;
  resolved?: boolean;
};

function titleFor(kind: ExternalMiniSiteKind, name: string) {
  return name ? `${EXTERNAL_PORTAL_LABELS[kind]} · ${name}` : EXTERNAL_PORTAL_LABELS[kind];
}

export default function ExternalMiniSiteManager({
  stationIdOverride,
  stationConfig,
}: {
  stationIdOverride?: string;
  stationConfig?: MiniSiteConfig | null;
}) {
  const { currentStation } = useStations();
  const { state } = useFuel();
  const stationId = stationIdOverride || currentStation?.id;
  const currencySymbol = resolveCurrencySymbol(state.companyData?.currency, currentStation?.currency);

  const { data: accounts } = useCloudKV<Account[]>("credit_accounts", stationId, []);
  const { data: creditTx } = useCloudKV<CreditTransaction[]>("credit_transactions", stationId, []);
  const { data: suppliers } = useCloudKV<Supplier[]>("suppliers_data", stationId, []);
  const { data: orders } = useCloudKV<PurchaseOrder[]>("purchase_orders", stationId, []);
  const { data: fleetCards } = useCloudKV<FleetCard[]>(CLOUD_KEYS.fleetCards, stationId, []);
  const { data: fleetUsage } = useCloudKV<FleetUsage[]>(CLOUD_KEYS.fleetUsage, stationId, []);
  const { data: loyaltyCustomers } = useCloudKV<LoyaltyCustomer[]>("loyalty_customers", stationId, []);
  const { data: contacts } = useCloudKV<CommContact[]>("comm_contacts", stationId, []);
  const { data: messages } = useCloudKV<CommMessage[]>("comm_messages", stationId, []);
  const { data: complaints } = useCloudKV<Complaint[]>("customer_complaints", stationId, []);

  const [miniConfig, setMiniConfig] = useState<MiniSiteConfig | null>(stationConfig || null);
  const [kind, setKind] = useState<ExternalMiniSiteKind>("customer");
  const [entityId, setEntityId] = useState("");
  const [expiryDays, setExpiryDays] = useState(30);
  const [busy, setBusy] = useState(false);
  const [links, setLinks] = useState<Array<ExternalMiniSiteLinkRecord & { expired: boolean }>>([]);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    if (stationConfig) {
      setMiniConfig(stationConfig);
      return;
    }
    let cancelled = false;
    void loadMiniSiteConfig(stationId).then((value) => {
      if (!cancelled) setMiniConfig(value);
    });
    return () => { cancelled = true; };
  }, [stationConfig, stationId]);

  const entities = useMemo(() => {
    switch (kind) {
      case "customer":
        return (accounts || []).map((x) => ({ id: x.id, label: x.customerName || x.name || x.id }));
      case "fleet-customer":
      case "driver":
        return (fleetCards || []).map((x) => ({
          id: x.id,
          label: kind === "driver"
            ? (x.driver ? `${x.driver} · ${x.cardNumber}` : x.cardNumber)
            : (x.accountName || x.cardNumber),
        }));
      case "supplier":
        return (suppliers || []).map((x) => ({ id: x.id, label: x.name || x.id }));
      case "invoice":
        return Object.entries(state.invoices || {}).map(([id, x]) => {
          const inv = x as Record<string, unknown>;
          return { id, label: `${id} · ${String(inv.customerName || (inv.customer as { name?: string } | undefined)?.name || "Invoice")}` };
        });
      case "communication":
        return (contacts || []).map((x) => ({ id: x.id, label: x.name || x.id }));
      case "support":
        return (complaints || []).map((x) => ({ id: x.id, label: `${x.customer || "Customer"} · ${x.subject || "Complaint"}` }));
      case "loyalty":
        return (loyaltyCustomers || []).map((x) => ({ id: x.id, label: x.name || x.id }));
      case "service":
        return stationId ? [{ id: stationId, label: currentStation?.name || "Station services" }] : [];
      default:
        return [];
    }
  }, [kind, accounts, fleetCards, suppliers, state.invoices, contacts, complaints, loyaltyCustomers, stationId, currentStation?.name]);

  useEffect(() => {
    if (entities.length === 0) {
      setEntityId(kind === "service" ? stationId || "" : "");
      return;
    }
    if (!entities.some((x) => x.id === entityId)) setEntityId(entities[0].id);
  }, [entities, entityId, kind, stationId]);

  const selected = useMemo(() => {
    switch (kind) {
      case "customer": return (accounts || []).find((x) => x.id === entityId);
      case "fleet-customer":
      case "driver": return (fleetCards || []).find((x) => x.id === entityId);
      case "supplier": return (suppliers || []).find((x) => x.id === entityId);
      case "invoice": return (state.invoices || {})[entityId] as Record<string, unknown> | undefined;
      case "communication": return (contacts || []).find((x) => x.id === entityId);
      case "support": return (complaints || []).find((x) => x.id === entityId);
      case "loyalty": return (loyaltyCustomers || []).find((x) => x.id === entityId);
      case "service": return miniConfig;
      default: return null;
    }
  }, [kind, accounts, fleetCards, suppliers, state.invoices, contacts, complaints, loyaltyCustomers, entityId, miniConfig]);

  const entityName = useMemo(() => {
    if (kind === "invoice") return String((selected as Record<string, unknown> | undefined)?.customerName || (selected as Record<string, unknown> | undefined)?.customer || "Invoice");
    if (kind === "service") return currentStation?.name || "Station services";
    if (kind === "support") return `${(selected as Complaint | undefined)?.customer || "Customer"} · ${(selected as Complaint | undefined)?.subject || "Complaint"}`;
    const x = selected as Record<string, unknown> | null;
    if (!x) return "";
    return String(x.customerName || x.name || x.accountName || x.driver || x.cardNumber || "Portal");
  }, [kind, selected, currentStation?.name]);

  const refreshLinks = async () => {
    if (!entityId) {
      setLinks([]);
      return;
    }
    setLinks(await listExternalMiniSiteLinks({ kind, entityId, stationId }));
  };

  useEffect(() => { void refreshLinks(); }, [kind, entityId, stationId]);

  const buildSections = (): ExternalMiniSiteSection[] => {
    const sections: ExternalMiniSiteSection[] = [];

    if (kind === "customer") {
      const account = selected as Account | undefined;
      const tx = (creditTx || [])
        .filter((x) => x.accountId === entityId)
        .sort((a,b) => String(b.date || b.createdAt || "").localeCompare(String(a.date || a.createdAt || "")))
        .slice(0, 30);
      const invoiceRows = Object.entries(state.invoices || {})
        .filter(([,v]) => {
          const inv = v as Record<string, unknown>;
          const customer = String(inv.customerName || (inv.customer as { name?: string } | undefined)?.name || "").trim().toLowerCase();
          return customer && customer === String(account?.customerName || account?.name || "").trim().toLowerCase();
        })
        .slice(0, 30);
      sections.push({ key:"overview", title:"Account overview", rows:[
        { label:"Balance", value: account?.balance ?? "—" },
        { label:"Credit limit", value: account?.creditLimit ?? "—" },
        { label:"Status", value: account?.status || "—" },
        { label:"Phone", value: account?.phone || "—" },
        { label:"Email", value: account?.email || "—" },
      ]});
      sections.push({ key:"statement", title:"Statement / activity", columns:["Date","Type","Amount","Description"], data:tx.map(x=>[x.date || x.createdAt || "—", x.type || "—", x.amount ?? "—", x.description || "—"]) });
      sections.push({ key:"invoices", title:"Invoices", columns:["Invoice","Date","Amount","Status"], data:invoiceRows.map(([id,v])=>{const x=v as Record<string,unknown>;return [id,String(x.date||"—"),x.totalAmount ?? x.total ?? "—",String(x.status||"unpaid")];})});
    }

    if (kind === "fleet-customer" || kind === "driver") {
      const card = selected as FleetCard | undefined;
      const usage = (fleetUsage || []).filter(x => x.cardId === entityId).sort((a,b)=>String(b.date).localeCompare(String(a.date))).slice(0,30);
      const driver = card?.driver || "";
      sections.push({ key:"fleet", title:"Fleet account", rows:[
        {label:"Card", value:card?.cardNumber || "—"},
        {label:"Vehicle", value:card?.plate || "—"},
        {label:"Driver", value:driver || "—"},
        {label:"Fuel product", value:card?.fuelProduct || "All fuels"},
        {label:"Transaction limit (L)", value:card?.txnLimitLitres ?? "—"},
        {label:"Daily spend limit", value:card?.dailyLimitAmount ?? "—"},
        {label:"Status", value:card?.status || "—"},
      ]});
      sections.push({key:"fuel-activity", title:"Fuel activity", columns:["Date","Fuel","Litres","Amount"], data:usage.map(x=>[x.date,x.fuelType,x.litres,x.amount])});
    }

    if (kind === "supplier") {
      const s = selected as Supplier | undefined;
      const rows = (orders || []).filter(x => String(x.supplierId || "") === entityId || String(x.supplierName || "") === String(s?.name || "")).slice(0,30);
      sections.push({key:"supplier", title:"Supplier account", rows:[
        {label:"Contact", value:s?.contactPerson || "—"},
        {label:"Phone", value:s?.phone || "—"},
        {label:"Email", value:s?.email || "—"},
        {label:"Status", value:s?.status || "—"},
        {label:"Credit limit", value:s?.creditLimit ?? "—"},
        {label:"Current balance", value:s?.currentBalance ?? "—"},
        {label:"Fuel types", value:(s?.fuelTypes || []).join(", ") || "—"},
      ]});
      sections.push({key:"orders", title:"Purchase orders / deliveries", columns:["Date","Fuel","Litres","Rate","Amount","Status"], data:rows.map(x=>[x.date || x.createdAt || "—",String(x.fuelType || "Fuel"),x.liters ?? "—",x.pricePerLiter ?? "—",x.amount ?? x.totalAmount ?? "—",x.status || "—"])});
      if (s?.notes) sections.push({key:"notes", title:"Notes", rows:[{label:"Station note",value:s.notes}]});
    }

    if (kind === "invoice") {
      const x = selected as Record<string, unknown> | undefined;
      const items = Array.isArray(x?.items) ? x.items as Array<Record<string,unknown>> : [];
      sections.push({key:"invoice", title:"Invoice", rows:[
        {label:"Invoice",value:entityId},
        {label:"Customer",value:String(x?.customerName || (x?.customer as {name?:string}|undefined)?.name || "—")},
        {label:"Date",value:String(x?.date || "—")},
        {label:"Total",value:x?.totalAmount ?? x?.total ?? "—"},
        {label:"Status",value:String(x?.status || "unpaid")},
      ]});
      sections.push({key:"items", title:"Line items", columns:["Description","Quantity","Unit price","Total"], data:items.slice(0,50).map(i=>[String(i.description || i.name || "Item"),i.quantity ?? "—",i.unitPrice ?? i.price ?? "—",i.total ?? "—"])});
    }

    if (kind === "communication") {
      const c = selected as CommContact | undefined;
      const own = (messages || []).filter(x => x.contactId === entityId).sort((a,b)=>String(b.timestamp).localeCompare(String(a.timestamp))).slice(0,40);
      sections.push({key:"contact", title:"Contact", rows:[
        {label:"Name",value:c?.name || "—"},{label:"Company",value:c?.company || "—"},{label:"Phone",value:c?.phone || "—"},{label:"Email",value:c?.email || "—"},{label:"Balance",value:c?.balance ?? "—"},{label:"Tags",value:(c?.tags||[]).join(", ") || "—"}
      ]});
      sections.push({key:"messages", title:"Communication history", columns:["Date","Type","Status","Message"], data:own.map(x=>[x.timestamp || "—",x.type || "—",x.status || "—",x.content || x.subject || "—"])});
    }

    if (kind === "support") {
      const c = selected as Complaint | undefined;
      sections.push({key:"complaint", title:"Support case", rows:[
        {label:"Customer",value:c?.customer || "—"},{label:"Issue",value:c?.subject || "—"},{label:"Severity",value:c?.severity || "—"},{label:"Opened",value:c?.date || "—"},{label:"Status",value:c?.resolved ? "Resolved" : "Open"}
      ]});
      sections.push({key:"communication", title:"Next step", rows:[{label:"Contact station",value:"Use the station call, email or WhatsApp actions below."}]});
    }

    if (kind === "loyalty") {
      const c = selected as LoyaltyCustomer | undefined;
      sections.push({key:"loyalty", title:"Loyalty account", rows:[
        {label:"Customer",value:c?.name || "—"},{label:"Points",value:c?.loyaltyPoints ?? 0},{label:"Tier",value:c?.tier || "—"},{label:"Total spent",value:c?.totalSpent ?? "—"},{label:"Phone",value:c?.phone || "—"},{label:"Email",value:c?.email || "—"}
      ]});
    }

    if (kind === "service") {
      const cfg = miniConfig;
      sections.push({key:"services", title:"Station services", data:(cfg?.services || []).map(s=>[s.title,s.description]), columns:["Service","Description"]});
      sections.push({key:"hours", title:"Opening hours", data:(cfg?.hours || []).map(h=>[String(h.day),h.closed ? "Closed" : `${h.open} – ${h.close}`]), columns:["Day","Hours"]});
      sections.push({key:"contact", title:"Station", rows:[{label:"Address",value:cfg?.address || currentStation?.location || "—"},{label:"Phone",value:cfg?.phone || currentStation?.phone || "—"},{label:"Email",value:cfg?.email || currentStation?.email || "—"}]});
    }

    return sections.filter(s => (s.rows && s.rows.length) || (s.data && s.data.length) || s.title);
  };

  const issue = async () => {
    if (!entityId || !entityName) {
      toastError("Select an entity with real saved data first.");
      return;
    }
    setBusy(true);
    try {
      const account = kind === "customer" ? selected as Account | undefined : undefined;
      const created = await createExternalMiniSiteLink({
        kind,
        entityId,
        entityName,
        stationId,
        stationName: currentStation?.name || state.companyData?.name || "",
        stationPhone: currentStation?.phone || state.companyData?.contacts,
        stationEmail: currentStation?.email || state.companyData?.email,
        currencySymbol,
        paymentInstructions: account?.paymentInstructions,
        expiryDays,
        sections: buildSections(),
      });
      if (!created) {
        toastError("Could not create the portal link.");
        return;
      }
      await refreshLinks();
      try { await navigator.clipboard.writeText(created.url); } catch {}
      toastSuccess("Secure portal link created and copied.");
    } finally {
      setBusy(false);
    }
  };

  const copy = async (token: string) => {
    try {
      await navigator.clipboard.writeText(externalMiniSiteUrl(token));
      setCopied(token);
      window.setTimeout(() => setCopied((x) => x === token ? null : x), 1500);
    } catch { toastError("Could not copy the link."); }
  };

  return (
    <div className="rounded-2xl border border-sky-200 bg-sky-50/50 p-5 dark:border-sky-900/50 dark:bg-sky-900/10 space-y-4">
      <div>
        <div className="flex items-center gap-2">
          <Link2 className="w-5 h-5 text-sky-600" />
          <h3 className="font-semibold text-gray-900 dark:text-white">External mini-sites / portals</h3>
        </div>
        <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">
          Issue a separate, expiring, revocable portal from the same existing records. No portal writes a fake payment or changes the canonical ledger.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-[1.1fr_1fr_auto]">
        <select value={kind} onChange={(e)=>setKind(e.target.value as ExternalMiniSiteKind)} className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-800 dark:text-white">
          {(Object.entries(EXTERNAL_PORTAL_LABELS) as Array<[ExternalMiniSiteKind,string]>).map(([value,label])=><option key={value} value={value}>{label}</option>)}
        </select>
        <select value={entityId} onChange={(e)=>setEntityId(e.target.value)} disabled={entities.length === 0} className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-800 dark:text-white">
          {entities.length === 0 ? <option value="">No saved records for this portal type</option> : entities.map(x=><option key={x.id} value={x.id}>{x.label}</option>)}
        </select>
        <div className="flex items-center gap-2">
          <input type="number" min={1} max={365} value={expiryDays} onChange={(e)=>setExpiryDays(Math.min(365,Math.max(1,Number(e.target.value)||30)))} aria-label="Portal expiry days" className="w-24 rounded-lg border border-gray-200 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-800 dark:text-white" />
          <span className="text-xs text-gray-500">days</span>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <button onClick={issue} disabled={busy || !entityId} className="inline-flex items-center gap-1.5 rounded-lg bg-sky-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Link2 className="w-3.5 h-3.5" />}
          Create secure portal
        </button>
        <button onClick={()=>void refreshLinks()} className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-medium dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200">
          <RefreshCw className="w-3.5 h-3.5" /> Refresh links
        </button>
      </div>

      {links.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-gray-600 dark:text-gray-300">Issued links for {titleFor(kind, entityName)}</p>
          {links.map((link) => (
            <div key={link.token} className="rounded-xl border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-800">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${link.expired ? "bg-gray-100 text-gray-500" : "bg-emerald-100 text-emerald-700"}`}>
                  {link.expired ? "Expired" : "Active"}
                </span>
                <code className="min-w-0 flex-1 truncate text-xs text-gray-600 dark:text-gray-300">{externalMiniSiteUrl(link.token)}</code>
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                {!link.expired && (
                  <>
                    <a href={externalMiniSiteUrl(link.token)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs"><ExternalLink className="w-3 h-3" /> Open</a>
                    <button onClick={()=>void copy(link.token)} className="inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs"><Copy className="w-3 h-3" /> {copied === link.token ? "Copied" : "Copy"}</button>
                    <button onClick={()=>window.open(`https://wa.me/?text=${encodeURIComponent(externalMiniSiteShareLine(link.token, `Open your ${EXTERNAL_PORTAL_LABELS[kind]}:`))}`,"_blank","noopener")} className="inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs"><MessageCircle className="w-3 h-3" /> WhatsApp</button>
                    <button onClick={async()=>{const ok=await revokeExternalMiniSiteLink(link.token, stationId); if(ok){toastSuccess("Portal link revoked."); await refreshLinks();}else toastError("Could not revoke portal link.");}} className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 px-2.5 py-1.5 text-xs text-red-600"><Ban className="w-3 h-3" /> Revoke</button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <p className="text-[11px] text-gray-500">
        Available portal types are connected to existing Customers/Credit, Fleet &amp; Drivers, Suppliers/Purchases, Invoices, Communication, Complaints/Support, Loyalty and Station Services data.
      </p>
    </div>
  );
}
