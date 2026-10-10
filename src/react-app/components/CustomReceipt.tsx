import { useMemo, useState } from "react";
import { Download, Eye, Plus, Save, Share2, Trash2, FilePlus2, RotateCcw, Upload } from "lucide-react";
import { useFuel } from "@/react-app/context/FuelContext";
import { useStations } from "@/react-app/context/StationContext";
import { useCloudKV } from "@/react-app/hooks/useCloudKV";
import { exportCustomReceiptPDF, type PdfOutputAction, type CustomReceiptPdfData } from "@/react-app/lib/invoice-pdf";
import { getCurrencySymbol } from "@/react-app/lib/currency";
import { formatNumber } from "@/react-app/utils/formatUtils";
import { toastError, toastSuccess } from "@/react-app/lib/toast";

type ReceiptLine = { id: string; description: string; details: string; quantity: number; rate: number };
type CustomReceipt = CustomReceiptPdfData & { id: string; updatedAt: string };
const today = () => new Date().toISOString().slice(0, 10);
const newLine = (): ReceiptLine => ({ id: crypto.randomUUID(), description: "", details: "", quantity: 1, rate: 0 });
const blankReceipt = (company: any, currency: string): CustomReceipt => ({
  id: crypto.randomUUID(), receiptNumber: "RCT-" + Date.now().toString().slice(-6),
  receiptDate: today(), invoiceReference: "", companyData: {
    name: company?.name || "", email: company?.email || "", contacts: company?.contacts || "",
    poBox: company?.poBox || "", logo: company?.logo || "", currency: company?.currency || currency,
    bankName: company?.bankName || "", branchName: company?.branchName || "",
    accountHolder: company?.accountHolder || "", accountNumber: company?.accountNumber || "",
  },
  currency: company?.currency || currency, customerName: "", customerAddress: "",
  subject: "", items: [newLine()], taxEnabled: false, taxRate: 16, amountReceivedWords: "",
  paymentStatus: "Paid in Full", paymentMethod: "", bankName: company?.bankName || "",
  branchName: company?.branchName || "", accountNumber: company?.accountNumber || "",
  issuedBy: company?.name || "", signatoryTitle: "Authorized Signatory / Accounts",
  receiptStampText: "OFFICIAL PAID STAMP HERE", notes: "", updatedAt: new Date().toISOString(),
});

const inputClass = "w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-gray-100";
const labelClass = "mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400";

export default function CustomReceipt() {
  const { state } = useFuel();
  const { currentStation } = useStations();
  const stationId = currentStation?.id;
  const { data: savedReceipts, setData: setSavedReceipts, loading } = useCloudKV<CustomReceipt[]>("custom_receipts", stationId, []);
  const currency = state.companyData?.currency || (currentStation as any)?.currency || "KES";
  const symbol = getCurrencySymbol(currency);
  const [draft, setDraft] = useState<CustomReceipt>(() => blankReceipt(state.companyData, currency));
  const [editingId, setEditingId] = useState<string | null>(null);
    const items = draft.items || [];
  const subtotal = useMemo(() => Math.round(items.reduce((s, i) => s + Math.max(0, Number(i.quantity) || 0) * Math.max(0, Number(i.rate) || 0), 0) * 100) / 100, [items]);
  const tax = draft.taxEnabled ? Math.round((subtotal * Math.max(0, Number(draft.taxRate) || 0) / 100 + Number.EPSILON) * 100) / 100 : 0;
  const total = Math.round((subtotal + tax + Number.EPSILON) * 100) / 100;
  const update = (patch: Partial<CustomReceipt>) => setDraft((old) => ({ ...old, ...patch, updatedAt: new Date().toISOString() }));
  const updateItem = (id: string, patch: Partial<ReceiptLine>) => update({ items: items.map((item) => item.id === id ? { ...item, ...patch } : item) });
  const reset = () => { setDraft(blankReceipt(state.companyData, currency)); setEditingId(null); };
  const save = () => {
    if (!draft.receiptNumber.trim()) { toastError("Enter a receipt number."); return; }
    if (!draft.customerName.trim()) { toastError("Enter who the payment was received from."); return; }
    if (!items.some((i) => i.description.trim() && i.quantity > 0)) { toastError("Add at least one described receipt item with a positive quantity."); return; }
    const saved = { ...draft, subtotal, taxAmount: tax, totalAmount: total, updatedAt: new Date().toISOString() };
    setSavedReceipts((previous) => {
      const list = Array.isArray(previous) ? previous : [];
      return editingId ? list.map((r) => r.id === editingId ? saved : r) : [saved, ...list];
    });
    setDraft(saved); setEditingId(saved.id); toastSuccess("Custom receipt saved to this station.");
  };
  const exportPdf = async (action: PdfOutputAction) => {
    try {
      await exportCustomReceiptPDF({
        ...draft,
        companyData: { ...draft.companyData, logo: draft.companyData?.logo || state.companyData?.logo || "" },
        subtotal, taxAmount: tax, totalAmount: total,
        currency: draft.currency || currency,
      }, action);
    } catch (error) { toastError(error instanceof Error ? error.message : "Could not create the receipt PDF."); }
  };
  const edit = (receipt: CustomReceipt) => { setDraft({ ...receipt, items: receipt.items?.length ? receipt.items : [newLine()] }); setEditingId(receipt.id); };
  const remove = (id: string) => {
    if (!window.confirm("Delete this saved custom receipt? This only removes the custom receipt draft, not any recorded sale.")) return;
    setSavedReceipts((previous) => (previous || []).filter((r) => r.id !== id));
    if (editingId === id) reset();
    toastSuccess("Custom receipt removed.");
  };
  const uploadLogo = (file?: File) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) { toastError("Choose an image file for the receipt logo."); return; }
    if (file.size > 2 * 1024 * 1024) { toastError("Logo must be 2 MB or smaller."); return; }
    const reader = new FileReader();
    reader.onload = () => update({ companyData: { ...draft.companyData, logo: String(reader.result || "") } });
    reader.onerror = () => toastError("Could not read that logo file.");
    reader.readAsDataURL(file);
  };
  const currencyCode = draft.currency || currency;
  const money = (n: number) => currencyCode + " " + formatNumber(n, 2);

  return <div className="space-y-5 p-4 sm:p-6">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h2 className="text-2xl font-bold text-gray-900 dark:text-white">Custom Receipt Builder</h2><p className="mt-1 max-w-3xl text-sm text-gray-500 dark:text-gray-400">Create a branded official receipt in the style of your reference: customer, invoice reference, item details, optional VAT, payment summary, bank details and signatory/stamp area.</p></div>
      <button type="button" onClick={reset} className="btn btn-outline flex items-center gap-2"><FilePlus2 size={16}/> New receipt</button>
    </div>
    <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.5fr)_minmax(280px,0.8fr)] gap-5">
      <div className="space-y-5">
        <section className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-4 sm:p-5 space-y-4">
          <h3 className="font-semibold text-gray-900 dark:text-white">Business & receipt details</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div><label className={labelClass}>Business / organization name</label><input className={inputClass} value={draft.companyData?.name || ""} onChange={e => update({companyData:{...draft.companyData,name:e.target.value}})} /></div>
            <div><label className={labelClass}>Receipt number</label><input className={inputClass} value={draft.receiptNumber} onChange={e=>update({receiptNumber:e.target.value})}/></div>
            <div><label className={labelClass}>Business tagline / service</label><input className={inputClass} value={draft.companyTagline || ""} onChange={e=>update({companyTagline:e.target.value})} placeholder="Transport, General Contracting & Logistics"/></div>
            <div><label className={labelClass}>Postal address / location</label><input className={inputClass} value={draft.companyData?.poBox || ""} onChange={e=>update({companyData:{...draft.companyData,poBox:e.target.value}})} placeholder="P.O. Box / town"/></div>
            <div><label className={labelClass}>Email</label><input className={inputClass} value={draft.companyData?.email || ""} onChange={e=>update({companyData:{...draft.companyData,email:e.target.value}})}/></div>
            <div><label className={labelClass}>Phone / contacts</label><input className={inputClass} value={draft.companyData?.contacts || ""} onChange={e=>update({companyData:{...draft.companyData,contacts:e.target.value}})}/></div>
            <div><label className={labelClass}>Receipt date</label><input type="date" className={inputClass} value={draft.receiptDate} onChange={e=>update({receiptDate:e.target.value})}/></div>
            <div><label className={labelClass}>Invoice reference (optional)</label><input className={inputClass} value={draft.invoiceReference} onChange={e=>update({invoiceReference:e.target.value})} placeholder="INV-0002"/></div>
            <div className="sm:col-span-2"><label className={labelClass}>Business logo</label><div className="flex flex-wrap items-center gap-3">{draft.companyData?.logo && <img src={draft.companyData.logo} alt="Receipt logo" className="h-14 max-w-36 object-contain rounded border p-1"/>}<label className="btn btn-outline cursor-pointer flex items-center gap-2"><Upload size={15}/> Upload logo<input type="file" accept="image/*" className="hidden" onChange={e=>uploadLogo(e.target.files?.[0])}/></label><span className="text-xs text-gray-500">PNG/JPG, max 2 MB. Uses company logo if none uploaded.</span></div></div>
          </div>
        </section>
        <section className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-4 sm:p-5 space-y-4">
          <h3 className="font-semibold text-gray-900 dark:text-white">Received from & payment</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div><label className={labelClass}>Received from (customer / organization)</label><input className={inputClass} value={draft.customerName} onChange={e=>update({customerName:e.target.value})} placeholder="Customer / organization name"/></div>
            <div><label className={labelClass}>Customer address / department</label><input className={inputClass} value={draft.customerAddress || ""} onChange={e=>update({customerAddress:e.target.value})}/></div>
            <div className="sm:col-span-2"><label className={labelClass}>Re: payment for</label><input className={inputClass} value={draft.subject} onChange={e=>update({subject:e.target.value})} placeholder="Payment for car hire services"/></div>
            <div><label className={labelClass}>Payment method / reference</label><input className={inputClass} value={draft.paymentMethod} onChange={e=>update({paymentMethod:e.target.value})} placeholder="Bank transfer, M-PESA, cash…"/></div>
            <div><label className={labelClass}>Payment status</label><select className={inputClass} value={draft.paymentStatus} onChange={e=>update({paymentStatus:e.target.value})}><option>Paid in Full</option><option>Partially Paid</option><option>Refunded</option><option>Pending Verification</option></select></div>
            <div><label className={labelClass}>Amount received in words</label><input className={inputClass} value={draft.amountReceivedWords || ""} onChange={e=>update({amountReceivedWords:e.target.value})} placeholder="Kenya Shillings Three Hundred…"/></div>
            <div><label className={labelClass}>Currency code</label><input className={inputClass} value={currencyCode} onChange={e=>update({currency:e.target.value.toUpperCase()})} maxLength={6}/></div>
          </div>
        </section>
        <section className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-4 sm:p-5 space-y-4">
          <div className="flex items-center justify-between gap-2"><h3 className="font-semibold text-gray-900 dark:text-white">Line items</h3><button type="button" className="btn btn-outline flex items-center gap-2" onClick={()=>update({items:[...items,newLine()]})}><Plus size={15}/> Add line</button></div>
          {items.map((item,index)=><div key={item.id} className="rounded-lg border border-gray-200 dark:border-gray-700 p-3 space-y-3">
            <div className="flex justify-between items-center"><span className="text-xs font-bold text-gray-500">LINE {index+1}</span><button type="button" aria-label="Remove line" onClick={()=>update({items:items.filter(i=>i.id!==item.id)})} disabled={items.length===1} className="text-red-600 disabled:opacity-30"><Trash2 size={16}/></button></div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3"><div><label className={labelClass}>Description</label><input className={inputClass} value={item.description} onChange={e=>updateItem(item.id,{description:e.target.value})} placeholder="Car hire services"/></div><div><label className={labelClass}>Additional details (optional)</label><input className={inputClass} value={item.details} onChange={e=>updateItem(item.id,{details:e.target.value})} placeholder="Vehicle registration, service dates…"/></div><div><label className={labelClass}>Quantity / days</label><input type="number" min="0" step="0.01" className={inputClass} value={item.quantity} onChange={e=>updateItem(item.id,{quantity:Math.max(0,Number(e.target.value)||0)})}/></div><div><label className={labelClass}>Rate per unit ({currencyCode})</label><input type="number" min="0" step="0.01" className={inputClass} value={item.rate} onChange={e=>updateItem(item.id,{rate:Math.max(0,Number(e.target.value)||0)})}/></div></div>
            <div className="text-right text-sm font-semibold">{money(item.quantity*item.rate)}</div>
          </div>)}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 p-4">
            <label className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={draft.taxEnabled} onChange={e=>update({taxEnabled:e.target.checked})}/> Apply tax / VAT</label>
            <div><label className={labelClass}>Tax rate (%)</label><input type="number" min="0" max="100" step="0.01" className={inputClass} disabled={!draft.taxEnabled} value={draft.taxRate} onChange={e=>update({taxRate:Math.min(100,Math.max(0,Number(e.target.value)||0))})}/></div>
            <div className="sm:col-span-2 space-y-2 text-sm"><div className="flex justify-between"><span>Subtotal</span><strong>{money(subtotal)}</strong></div>{draft.taxEnabled && <div className="flex justify-between"><span>{draft.taxRate}% VAT / Tax</span><strong>{money(tax)}</strong></div>}<div className="flex justify-between border-t border-amber-300 pt-2 text-base"><span className="font-bold">Total paid / due</span><strong>{money(total)}</strong></div></div>
          </div>
        </section>
        <section className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-4 sm:p-5 space-y-4">
          <h3 className="font-semibold text-gray-900 dark:text-white">Payment summary & authorization</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div><label className={labelClass}>Bank</label><input className={inputClass} value={draft.bankName || ""} onChange={e=>update({bankName:e.target.value})}/></div>
            <div><label className={labelClass}>Branch</label><input className={inputClass} value={draft.branchName || ""} onChange={e=>update({branchName:e.target.value})}/></div>
            <div><label className={labelClass}>Account number</label><input className={inputClass} value={draft.accountNumber || ""} onChange={e=>update({accountNumber:e.target.value})}/></div>
            <div><label className={labelClass}>Issued by</label><input className={inputClass} value={draft.issuedBy || ""} onChange={e=>update({issuedBy:e.target.value})}/></div>
            <div><label className={labelClass}>Signatory title</label><input className={inputClass} value={draft.signatoryTitle || ""} onChange={e=>update({signatoryTitle:e.target.value})}/></div>
            <div><label className={labelClass}>Stamp box text</label><input className={inputClass} value={draft.receiptStampText || ""} onChange={e=>update({receiptStampText:e.target.value})}/></div>
            <div className="sm:col-span-2"><label className={labelClass}>Notes / terms (optional)</label><textarea className={inputClass} rows={2} value={draft.notes || ""} onChange={e=>update({notes:e.target.value})}/></div>
          </div>
        </section>
        <div className="flex flex-wrap gap-2"><button type="button" onClick={save} className="btn btn-primary flex items-center gap-2"><Save size={16}/>{editingId ? "Save changes" : "Save receipt"}</button><button type="button" onClick={()=>exportPdf("preview")} className="btn btn-outline flex items-center gap-2"><Eye size={16}/> Preview PDF</button><button type="button" onClick={()=>exportPdf("download")} className="btn btn-outline flex items-center gap-2"><Download size={16}/> Download PDF</button><button type="button" onClick={()=>exportPdf("share")} className="btn btn-outline flex items-center gap-2"><Share2 size={16}/> Share PDF</button></div>
      </div>
      <aside className="space-y-4">
        <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-4"><h3 className="mb-3 font-semibold">Live total summary</h3><div className="space-y-2 text-sm"><div className="flex justify-between gap-2"><span>Subtotal</span><strong>{money(subtotal)}</strong></div><div className="flex justify-between gap-2"><span>Tax</span><strong>{money(tax)}</strong></div><div className="flex justify-between gap-2 border-t pt-3 text-lg"><span>Total</span><strong>{money(total)}</strong></div></div><p className="mt-3 text-xs text-gray-500">Amounts are rounded to 2 decimal places. Tax is not applied unless you enable it.</p></div>
        <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-4"><div className="mb-3 flex items-center justify-between"><h3 className="font-semibold">Saved custom receipts</h3><span className="text-xs text-gray-500">{(savedReceipts || []).length}</span></div>{loading ? <p className="text-sm text-gray-500">Loading…</p> : !savedReceipts?.length ? <p className="text-sm text-gray-500">No saved custom receipts yet.</p> : <div className="space-y-2">{savedReceipts.map(receipt=><div key={receipt.id} className="rounded-lg border border-gray-200 dark:border-gray-700 p-3"><div className="font-semibold text-sm">{receipt.receiptNumber}</div><div className="text-xs text-gray-500">{receipt.customerName || "No customer"} · {receipt.receiptDate}</div><div className="text-sm mt-1">{receipt.currency} {formatNumber(receipt.totalAmount || 0,2)}</div><div className="mt-2 flex flex-wrap gap-2"><button className="btn btn-outline btn-sm" onClick={()=>edit(receipt)}>Edit</button><button className="btn btn-outline btn-sm" onClick={()=>void exportCustomReceiptPDF(receipt,"preview").catch(e=>toastError(e instanceof Error?e.message:"PDF preview failed."))}><Eye size={13}/> View</button><button className="text-red-600 p-1" aria-label="Delete saved custom receipt" onClick={()=>remove(receipt.id)}><Trash2 size={14}/></button></div></div>)}</div>}</div>
        <button type="button" className="btn btn-outline w-full flex items-center justify-center gap-2" onClick={reset}><RotateCcw size={15}/> Reset form</button>
      </aside>
    </div>
  </div>;
}
