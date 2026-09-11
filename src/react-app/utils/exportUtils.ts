import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import * as XLSX from "xlsx";
import { saveAs } from "file-saver";
import { formatNumber } from "./formatUtils";
import {
  getCurrencySymbol,
  getDetectedCountryCode,
} from "@/react-app/lib/currency";
import {
  getFuelLabel,
  getFuelCode,
  normalizeFuelType,
  getBasePrice,
  type CanonicalFuelType,
} from "@/react-app/config/pricing";
import cloudStorageService from "@/react-app/lib/cloud-storage-service";

/**
 * Load a logo image (data URL or external URL) as a base64 data URL so it can
 * be embedded into a jsPDF document via `doc.addImage`. External URLs are
 * fetched and drawn to an off-screen canvas to bypass CORS/tainting issues.
 * Returns null if the image cannot be loaded (the caller simply omits it).
 */
export async function loadLogoAsDataURL(
  logoSrc: string | undefined | null,
): Promise<string | null> {
  if (!logoSrc || typeof logoSrc !== "string" || logoSrc.trim() === "") {
    return null;
  }
  // Already a data URL — use directly.
  if (logoSrc.startsWith("data:")) {
    return logoSrc;
  }
  try {
    const img = new Image();
    img.crossOrigin = "anonymous";
    const loaded = await new Promise<HTMLImageElement | null>((resolve) => {
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = logoSrc;
    });
    if (!loaded) return null;
    const canvas = document.createElement("canvas");
    canvas.width = loaded.naturalWidth || loaded.width;
    canvas.height = loaded.naturalHeight || loaded.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(loaded, 0, 0);
    try {
      return canvas.toDataURL("image/png");
    } catch {
      // Canvas tainted by cross-origin image — fall back to fetching as blob.
      try {
        const resp = await fetch(logoSrc, { mode: "cors" });
        const blob = await resp.blob();
        return await new Promise<string | null>((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () =>
            resolve(typeof reader.result === "string" ? reader.result : null);
          reader.onerror = () => resolve(null);
          reader.readAsDataURL(blob);
        });
      } catch {
        return null;
      }
    }
  } catch {
    return null;
  }
}

/**
 * Add the company logo to a jsPDF document at the given position. Returns the
 * new Y coordinate after the logo (so subsequent text doesn't overlap).
 * If the logo cannot be loaded, returns the original Y (no logo drawn).
 */
export async function addLogoToPDF(
  doc: jsPDF,
  logoSrc: string | undefined | null,
  x: number,
  y: number,
  w: number,
  h: number,
): Promise<number> {
  const dataUrl = await loadLogoAsDataURL(logoSrc);
  if (!dataUrl) return y;
  try {
    doc.addImage(dataUrl, "PNG", x, y, w, h);
    return y + h + 5;
  } catch {
    return y;
  }
}

/**
 * Derive the list of configured fuel types (canonical keys) from the app
 * state. Used by the sales/delivery export functions so they iterate the
 * station's ACTUAL fuel types (Kerosene, V-Power, LPG, …) instead of the
 * legacy hardcoded PMS/AGO.
 *
 * Resolution order:
 *  1. state.fuelTypes (the FuelTypesManager config array) — canonical keys.
 *  2. The `fuel_types_config` cloud row (read synchronously via the
 *     cloudStorageService in-memory cache — the SAME source FuelTypesManager
 *     edits). This is the fix for the reported mismatch: FuelContext's
 *     `state.fuelTypes` is never populated, so relying on it alone yielded
 *     the petrol/diesel fallback instead of the station's registered fuels.
 *  3. state.fuelPumpsByType / state.fuelPricesByType / state.fuelTankValuesByType
 *     keys (defense-in-depth: any fuel type that has pumps/prices/tank data).
 *  4. Fallback: ["petrol", "diesel"] ONLY if nothing is configured (first run).
 */
/**
 * Refresh the fuel_types_config in-memory cache from cloud before generating
 * a document, so the export ALWAYS uses the station's current registered fuel
 * types + prices — even on the very first export after a fresh login on a new
 * device (where the cache may not yet be populated).
 */
async function loadFuelTypesForExport(): Promise<Array<{
  name?: string;
  price?: number;
  active?: boolean;
}> | null> {
  try {
    const data =
      await cloudStorageService.get<
        Array<{ name?: string; price?: number; active?: boolean }>
      >("fuel_types_config");
    if (Array.isArray(data) && data.length > 0) return data;
  } catch {
    /* non-fatal — fall back to the in-memory cache below */
  }
  try {
    const cached =
      cloudStorageService.getCached<
        Array<{ name?: string; price?: number; active?: boolean }>
      >("fuel_types_config");
    if (Array.isArray(cached) && cached.length > 0) return cached;
  } catch {
    /* ignore */
  }
  return null;
}

function deriveFuelTypes(
  state: any,
  cloudFuelTypes?: any[] | null,
): CanonicalFuelType[] {
  const set = new Set<CanonicalFuelType>();
  for (const list of [cloudFuelTypes, state.fuelTypes]) {
    if (Array.isArray(list)) {
      for (const ft of list) {
        const key =
          typeof ft === "string" ? ft : ft?.canonical || ft?.type || ft?.name;
        const canonical = key ? normalizeFuelType(String(key)) : null;
        if (canonical) set.add(canonical);
      }
    }
  }
  // FIX: pull the station's registered fuel types from the fuel_types_config
  // cloud row (read synchronously from the in-memory cache). FuelContext's
  // state.fuelTypes is never populated, so without this the export derived
  // the petrol/diesel fallback instead of the station's actual fuels.
  try {
    const cached =
      cloudStorageService.getCached<
        Array<{ name?: string; canonical?: string }>
      >("fuel_types_config");
    if (Array.isArray(cached)) {
      for (const ft of cached) {
        const key = ft?.canonical || ft?.name;
        const canonical = key ? normalizeFuelType(key) : null;
        if (canonical) set.add(canonical);
      }
    }
  } catch {
    /* non-fatal — fall through to the other sources */
  }
  for (const store of [
    state.fuelPumpsByType,
    state.fuelPricesByType,
    state.fuelTankValuesByType,
  ]) {
    if (store && typeof store === "object") {
      for (const key of Object.keys(store)) {
        const canonical = key ? normalizeFuelType(key) : null;
        if (canonical) set.add(canonical);
      }
    }
  }
  // Also include petrol/diesel if they have legacy pump arrays (pmsPumps/agoPumps)
  if (Array.isArray(state.pmsPumps) && state.pmsPumps.length > 0)
    set.add("petrol");
  if (Array.isArray(state.agoPumps) && state.agoPumps.length > 0)
    set.add("diesel");
  if (set.size === 0) {
    set.add("petrol");
    set.add("diesel");
  }
  return Array.from(set);
}

/**
 * Get the pump array for a given fuel type from state. Petrol/diesel use the
 * legacy pmsPumps/agoPumps fields; all other types use fuelPumpsByType[type].
 */
function getPumpsForType(state: any, type: CanonicalFuelType): any[] {
  if (type === "petrol")
    return state.pmsPumps || state.fuelPumpsByType?.petrol || [];
  if (type === "diesel")
    return state.agoPumps || state.fuelPumpsByType?.diesel || [];
  return state.fuelPumpsByType?.[type] || [];
}

/**
 * Get the price for a given fuel type from state. Petrol/diesel use the legacy
 * pmsPrice/agoPrice fields; all other types use fuelPricesByType[type].
 */
function getPriceForType(
  state: any,
  type: CanonicalFuelType,
  cloudFuelTypes?: any[] | null,
): number {
  // Prefer the station's configured fuel_types_config price (the same source
  // FuelTypesManager edits + the UI reads). Use the freshly-loaded list when
  // the caller passed one (guaranteed current), else the in-memory cache.
  try {
    const cached =
      Array.isArray(cloudFuelTypes) && cloudFuelTypes.length > 0
        ? cloudFuelTypes
        : cloudStorageService.getCached<
            Array<{ name?: string; price?: number; active?: boolean }>
          >("fuel_types_config");
    if (Array.isArray(cached)) {
      for (const ft of cached) {
        if (ft?.active === false) continue;
        const canonical = ft?.name ? normalizeFuelType(ft.name) : null;
        if (
          canonical === type &&
          typeof ft?.price === "number" &&
          ft.price > 0
        ) {
          // Kenya-stale-price guard (mirrors the UI's useStationFuelTypes):
          // on a non-Kenya station, a stored price >= 100/L is a leftover
          // Kenya KSh value — use the country-appropriate fallback instead.
          const cc = getDetectedCountryCode();
          if (cc && cc !== "KE" && ft.price >= 100) {
            const base = getBasePrice(type, cc);
            if (base > 0 && base < 100) return base;
          }
          return ft.price;
        }
      }
    }
  } catch {
    /* non-fatal — fall through to the in-memory state */
  }
  if (type === "petrol")
    return (
      state.fuelPricesByType?.petrol ?? state.pmsPrice ?? state.petrolPrice ?? 0
    );
  if (type === "diesel")
    return (
      state.fuelPricesByType?.diesel ?? state.agoPrice ?? state.dieselPrice ?? 0
    );
  return state.fuelPricesByType?.[type] ?? 0;
}

/**
 * Get the tank opening/closing values for a given fuel type. Petrol/diesel use
 * the legacy pmsTankOpening/Closing fields; all other types use
 * fuelTankValuesByType[type].
 */
function getTankForType(
  state: any,
  type: CanonicalFuelType,
): { opening: number; closing: number } {
  if (type === "petrol")
    return {
      opening: state.pmsTankOpening ?? 0,
      closing: state.pmsTankClosing ?? 0,
    };
  if (type === "diesel")
    return {
      opening: state.agoTankOpening ?? 0,
      closing: state.agoTankClosing ?? 0,
    };
  return state.fuelTankValuesByType?.[type] ?? { opening: 0, closing: 0 };
}

export async function exportDeliveryPDF(state: any) {
  const doc = new jsPDF();

  // WORLDWIDE: derive the currency symbol from the company/station currency.
  const currencySymbol = getCurrencySymbol(state.companyData?.currency);

  let y = 20;
  if (state.companyData?.logo) {
    y = await addLogoToPDF(doc, state.companyData.logo, 80, 10, 50, 20);
  }

  // Company name in gold with bold styling
  doc.setFontSize(16);
  doc.setTextColor("#d4af37");
  doc.setFont("helvetica", "bold");
  doc.text(
    state.companyData?.name || state.companyData?.companyName || "Fuel Station",
    105,
    y,
    {
      align: "center",
    },
  );

  // Reset to normal text color and size
  doc.setTextColor("#1a3a5f");
  y += 10;
  doc.setFontSize(12);
  doc.setFont("helvetica", "bold");
  doc.text("Fuel Delivery Report", 105, y, { align: "center" });
  y += 20;

  // Add business info
  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.text(`FUEL DELIVERED TO: ${state.deliveredTo || "Client"}`, 14, y);
  y += 8;
  doc.text(`TOTAL ORDER: ${state.totalOrder || "N/A"} Litres`, 14, y);
  y += 8;
  doc.text(`YEAR: ${state.deliveryYear || new Date().getFullYear()}`, 14, y);
  y += 8;

  // DYNAMIC: list each configured fuel's price (was hardcoded Petrol/Diesel).
  const cloudFuelTypes = await loadFuelTypesForExport();
  const fuelTypes = deriveFuelTypes(state, cloudFuelTypes);
  for (const ft of fuelTypes) {
    const label = getFuelLabel(ft);
    const price = getPriceForType(state, ft, cloudFuelTypes);
    doc.text(
      `${label} Price: ${currencySymbol} ${formatNumber(price)} /L`,
      14,
      y,
    );
    y += 8;
  }

  // Create table data
  const headers = state.deliveryData.columns.map((col: any) => col.label);
  const data = state.deliveryData.rows.map((r: any) =>
    state.deliveryData.columns.map((col: any) => {
      if (col.key === "amount")
        return `${currencySymbol} ${formatNumber(r.amount)}`;
      if (col.key === "debt")
        return `${currencySymbol} ${formatNumber(r.debt)}`;
      return r[col.key] || "";
    }),
  );

  autoTable(doc, {
    startY: y,
    head: [headers],
    body: data,
    theme: "striped",
  });

  const finalY = (doc as any).lastAutoTable.finalY + 10;

  // Totals below the table
  doc.setFont("helvetica", "bold");
  doc.text(
    `Total Supplied: ${formatNumber(state.deliveryData.totals.totalSupplied)} L`,
    14,
    finalY,
  );
  doc.text(
    `Total Payments: ${currencySymbol} ${formatNumber(state.deliveryData.totals.totalPayments)}`,
    70,
    finalY,
  );
  doc.text(
    `Balance Due: ${currencySymbol} ${formatNumber(state.deliveryData.totals.balanceDue, 2)}`,
    130,
    finalY,
  );
  y = finalY + 10;

  // Contact info
  doc.setFont("helvetica", "normal");
  doc.text(`P.O. Box: ${state.companyData.poBox || "N/A"}`, 14, y);
  y += 8;
  doc.text(`CONTACTS: ${state.companyData.contacts || "N/A"}`, 14, y);
  y += 8;
  doc.text(`EMAIL: ${state.companyData.email || "N/A"}`, 14, y);
  y += 10;

  doc.save(`Delivery_Report_${state.deliveredTo || "Client"}.pdf`);
}

export async function exportDeliveryExcel(state: any) {
  const wb = XLSX.utils.book_new();
  // WORLDWIDE: derive the currency symbol from the company/station currency.
  const currencySymbol = getCurrencySymbol(state.companyData?.currency);

  // DYNAMIC: list each configured fuel's price (was hardcoded Petrol/Diesel).
  const cloudFuelTypes = await loadFuelTypesForExport();
  const fuelTypes = deriveFuelTypes(state, cloudFuelTypes);
  const priceRows: string[] = [];
  for (const ft of fuelTypes) {
    const label = getFuelLabel(ft);
    const price = getPriceForType(state, ft, cloudFuelTypes);
    priceRows.push(
      `${label} Price: ${currencySymbol} ${formatNumber(price)} /L`,
    );
  }

  const ws_data = [
    [
      state.companyData?.name ||
        state.companyData?.companyName ||
        "Fuel Station",
    ],
    ["Fuel Delivery Report"],
    [],
    [`FUEL DELIVERED TO: ${state.deliveredTo || "Client"}`],
    [`TOTAL ORDER: ${state.totalOrder || "N/A"} Litres`],
    [`YEAR: ${state.deliveryYear || new Date().getFullYear()}`],
    ...priceRows.map((p) => [p]),
    [],
    state.deliveryData.columns.map((col: any) => col.label),
    ...state.deliveryData.rows.map((r: any) =>
      state.deliveryData.columns.map((col: any) => {
        if (col.key === "amount")
          return `${currencySymbol} ${formatNumber(r.amount)}`;
        if (col.key === "debt")
          return `${currencySymbol} ${formatNumber(r.debt)}`;
        return r[col.key] || "";
      }),
    ),
    [],
    [
      `Total Supplied: ${formatNumber(state.deliveryData.totals.totalSupplied)} L`,
    ],
    [
      `Total Payments: ${currencySymbol} ${formatNumber(state.deliveryData.totals.totalPayments)}`,
    ],
    [
      `Balance Due: ${currencySymbol} ${formatNumber(state.deliveryData.totals.balanceDue, 2)}`,
    ],
    [],
    [`P.O. Box: ${state.companyData.poBox || "N/A"}`],
    [`CONTACTS: ${state.companyData.contacts || "N/A"}`],
    [`EMAIL: ${state.companyData.email || "N/A"}`],
  ];

  const ws = XLSX.utils.aoa_to_sheet(ws_data);
  XLSX.utils.book_append_sheet(wb, ws, "Delivery Report");
  XLSX.writeFile(wb, `Delivery_Report_${state.deliveredTo || "Client"}.xlsx`);
}

export async function exportDeliveryTXT(state: any) {
  // WORLDWIDE: derive the currency symbol from the company/station currency.
  const currencySymbol = getCurrencySymbol(state.companyData?.currency);
  let txt = `=== ${state.companyData?.name || state.companyData?.companyName || "Fuel Station"} ===\nFuel Delivery Report\n\n`;
  txt += `FUEL DELIVERED TO: ${state.deliveredTo || "Client"}\n`;
  txt += `TOTAL ORDER: ${state.totalOrder || "N/A"} Litres\n`;
  txt += `YEAR: ${state.deliveryYear || new Date().getFullYear()}\n`;

  // DYNAMIC: list each configured fuel's price (was hardcoded Petrol/Diesel).
  const cloudFuelTypes = await loadFuelTypesForExport();
  const fuelTypes = deriveFuelTypes(state, cloudFuelTypes);
  for (const ft of fuelTypes) {
    const label = getFuelLabel(ft);
    const price = getPriceForType(state, ft, cloudFuelTypes);
    txt += `${label} Price: ${currencySymbol} ${formatNumber(price)} /L\n`;
  }
  txt += "\n";

  txt += state.deliveryData.rows
    .map((r: any) =>
      state.deliveryData.columns
        .map((col: any) => {
          if (col.key === "amount")
            return `${col.label}: ${currencySymbol}${formatNumber(r.amount)}`;
          if (col.key === "debt")
            return `${col.label}: ${currencySymbol}${formatNumber(r.debt)}`;
          return `${col.label}: ${r[col.key] || ""}`;
        })
        .join(" | "),
    )
    .join("\n");

  txt += `\n\n`;
  txt += `Total Supplied: ${formatNumber(state.deliveryData.totals.totalSupplied)} L\n`;
  txt += `Total Payments: ${currencySymbol} ${formatNumber(state.deliveryData.totals.totalPayments)}\n`;
  txt += `Balance Due: ${currencySymbol} ${formatNumber(state.deliveryData.totals.balanceDue, 2)}\n\n`;
  txt += `P.O. Box: ${state.companyData.poBox || "N/A"}\n`;
  txt += `CONTACTS: ${state.companyData.contacts || "N/A"}\n`;
  txt += `EMAIL: ${state.companyData.email || "N/A"}`;

  const blob = new Blob([txt], { type: "text/plain" });
  saveAs(blob, `Delivery_Report_${state.deliveredTo || "Client"}.txt`);
}

export async function exportDebtPDF(state: any) {
  const data = state.debtData;
  const doc = new jsPDF();

  // WORLDWIDE: derive the currency symbol from the company/station currency.
  const currencySymbol = getCurrencySymbol(state.companyData?.currency);

  let y = 20;
  if (state.companyData?.logo) {
    y = await addLogoToPDF(doc, state.companyData.logo, 80, 10, 50, 20);
  }

  doc.setFontSize(16);
  doc.setTextColor("#d4af37");
  doc.setFont("helvetica", "bold");
  doc.text(
    state.companyData?.name || state.companyData?.companyName || "Fuel Station",
    105,
    y,
    {
      align: "center",
    },
  );
  doc.setTextColor("#1a3a5f");

  y += 10;
  doc.setFontSize(14);
  doc.setFont("helvetica", "bold");
  doc.text("Fuel Debt Payment Reminder", 105, y, { align: "center" });
  y += 15;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(12);
  const lines = [
    `Dear ${data.name},`,
    ``,
    `This is a gentle reminder that ${currencySymbol} ${data.amount} for fuel supplied remains unpaid.`,
    ``,
    `Kindly settle the amount via Till:`,
    `Buy Goods: ${data.till}`,
    ``,
    `For bank transfer:`,
    `Bank: ${data.bank}`,
    `A/C Name: ${data.acName}`,
    `A/C No.: ${data.acNo}`,
    ``,
    `After payment, share the confirmation with us via ${data.method}: ${data.contact}`,
    ``,
    `Thank you.`,
    ``,
    `Best regards,`,
    `${data.manager}`,
    `Manager`,
    `${state.companyData?.name || state.companyData?.companyName || "Fuel Station"}`,
    ``,
    `P.O. Box: ${state.companyData.poBox || "N/A"}`,
    `CONTACTS: ${state.companyData.contacts || "N/A"}`,
    `EMAIL: ${state.companyData.email || "N/A"}`,
  ];
  doc.text(lines, 15, y, { maxWidth: 180 });

  doc.save(`Debt_Reminder_${data.name}.pdf`);
}

export function exportDebtExcel(state: any) {
  const data = state.debtData;
  const wb = XLSX.utils.book_new();
  // WORLDWIDE: derive the currency symbol from the company/station currency.
  const currencySymbol = getCurrencySymbol(state.companyData?.currency);
  const ws_data = [
    ["Fuel Debt Payment Reminder"],
    [],
    [`Dear ${data.name},`],
    [],
    [
      `This is a gentle reminder that ${currencySymbol} ${data.amount} for fuel supplied remains unpaid.`,
    ],
    [],
    ["Kindly settle the amount via Till:"],
    [`Buy Goods: ${data.till}`],
    [],
    ["For bank transfer:"],
    [`Bank: ${data.bank}`],
    [`A/C Name: ${data.acName}`],
    [`A/C No.: ${data.acNo}`],
    [],
    [
      `After payment, share the confirmation with us via ${data.method}: ${data.contact}`,
    ],
    [],
    ["Thank you."],
    [],
    ["Best regards,"],
    [`${data.manager}`],
    ["Manager"],
    [
      `${state.companyData?.name || state.companyData?.companyName || "Fuel Station"}`,
    ],
    [],
    [`P.O. Box: ${state.companyData.poBox || "N/A"}`],
    [`CONTACTS: ${state.companyData.contacts || "N/A"}`],
    [`EMAIL: ${state.companyData.email || "N/A"}`],
  ];
  const ws = XLSX.utils.aoa_to_sheet(ws_data);
  XLSX.utils.book_append_sheet(wb, ws, "Debt Reminder");
  XLSX.writeFile(wb, `Debt_Reminder_${data.name}.xlsx`);
}

export function exportDebtTXT(state: any) {
  const data = state.debtData;
  const companyName =
    state.companyData?.name || state.companyData?.companyName || "Fuel Station";
  // WORLDWIDE: derive the currency symbol from the company/station currency.
  const currencySymbol = getCurrencySymbol(state.companyData?.currency);
  const txt = `=== ${companyName} ===\nFuel Debt Payment Reminder\n\nDear ${data.name},\n\nThis is a gentle reminder that ${currencySymbol} ${data.amount} for fuel supplied remains unpaid.\n\nKindly settle the amount via Till:\nBuy Goods: ${data.till}\n\nFor bank transfer:\nBank: ${data.bank}\nA/C Name: ${data.acName}\nA/C No.: ${data.acNo}\n\nAfter payment, share the confirmation with us via ${data.method}: ${data.contact}\n\nThank you.\n\nBest regards,\n${data.manager}\nManager\n${companyName}\n\nP.O. Box: ${state.companyData.poBox || "N/A"}\nCONTACTS: ${state.companyData.contacts || "N/A"}\nEMAIL: ${state.companyData.email || "N/A"}`;
  const blob = new Blob([txt], { type: "text/plain" });
  saveAs(blob, `Fuel_Debt_Reminder_${data.name}.txt`);
}

export async function exportSalesPDF(state: any) {
  const doc = new jsPDF();

  // WORLDWIDE: derive the currency symbol from the company/station currency.
  const currencySymbol = getCurrencySymbol(state.companyData?.currency);

  let y = 20;
  if (state.companyData?.logo) {
    y = await addLogoToPDF(doc, state.companyData.logo, 80, 10, 50, 20);
  }

  doc.setFontSize(16);
  doc.setTextColor("#d4af37");
  doc.setFont("helvetica", "bold");
  doc.text(
    state.companyData?.name || state.companyData?.companyName || "Fuel Station",
    105,
    y,
    {
      align: "center",
    },
  );
  doc.setTextColor("#1a3a5f");

  y += 10;
  doc.setFontSize(14);
  doc.setFont("helvetica", "bold");
  doc.text("Fuel Sales Report", 105, y, { align: "center" });
  y += 20;

  doc.setFontSize(12);
  doc.setFont("helvetica", "normal");
  doc.text(`Date: ${state.salesDate}`, 15, y);
  doc.text(`Shift: ${state.shift}`, 100, y);
  y += 15;

  // DYNAMIC fuel-type pump tables — iterates the station's configured fuel
  // types (Kerosene, V-Power, LPG, …) instead of the legacy hardcoded
  // Petrol (PMS) + Diesel (AGO). A station with N fuel types gets N tables.
  const cloudFuelTypes = await loadFuelTypesForExport();
  const fuelTypes = deriveFuelTypes(state, cloudFuelTypes);
  for (const ft of fuelTypes) {
    const pumps = getPumpsForType(state, ft);
    if (!pumps || pumps.length === 0) continue;
    const label = getFuelLabel(ft);
    const code = getFuelCode(ft);
    doc.setFont("helvetica", "bold");
    doc.text(`${label} (${code}) Pumps:`, 15, y);
    y += 10;

    const headers = [
      "Pump ID",
      `Opening (${currencySymbol})`,
      `Closing (${currencySymbol})`,
      "Opening (L)",
      "Closing (L)",
      "Sales (L)",
      `Sales (${currencySymbol})`,
    ];
    const data = pumps.map((p: any) => [
      p.id,
      formatNumber(p.openingKsh),
      formatNumber(p.closingKsh),
      formatNumber(p.openingL),
      formatNumber(p.closingL),
      formatNumber(p.salesL),
      formatNumber(p.salesKsh),
    ]);

    autoTable(doc, {
      startY: y,
      head: [headers],
      body: data,
      theme: "striped",
      headStyles: { fillColor: [26, 58, 95] },
    });

    y = (doc as any).lastAutoTable.finalY + 15;
  }

  // Add summary — dynamic per fuel type
  if (state.summary) {
    doc.setFont("helvetica", "bold");
    doc.text("Daily Summary:", 15, y);
    y += 10;
    doc.setFont("helvetica", "normal");
    const salesByType =
      (state.summary.salesByType as Record<string, number>) || {};
    for (const ft of fuelTypes) {
      const label = getFuelLabel(ft);
      const sales = salesByType[ft] ?? 0;
      doc.text(
        `Total ${label} Sales: ${currencySymbol} ${formatNumber(sales, 2)}`,
        15,
        y,
      );
      y += 8;
    }
    doc.text(
      `Total Revenue: ${currencySymbol} ${formatNumber(state.summary.totalRevenue, 2)}`,
      15,
      y,
    );
    y += 8;
    doc.text(
      `Cash In Hand: ${currencySymbol} ${formatNumber(state.summary.cashInHand, 2)}`,
      15,
      y,
    );
    y += 8;
    doc.text(
      `Net Income: ${currencySymbol} ${formatNumber(state.summary.netIncome, 2)}`,
      15,
      y,
    );
    y += 12;
  }

  // Fuel Tank Inventory — one entry per configured fuel type (previously
  // missing from the PDF). Shows the opening/closing tank levels for each fuel.
  if (y > 250) {
    doc.addPage();
    y = 20;
  }
  doc.setFont("helvetica", "bold");
  doc.text("Fuel Tank Inventory:", 15, y);
  y += 8;
  doc.setFont("helvetica", "normal");
  for (const ft of fuelTypes) {
    const label = getFuelLabel(ft);
    const code = getFuelCode(ft);
    const tv = getTankForType(state, ft);
    doc.text(
      `${label} (${code}): Opening ${formatNumber(tv.opening)} L, Closing ${formatNumber(tv.closing)} L`,
      20,
      y,
    );
    y += 7;
  }
  y += 8;

  // Fuel Pricing per type (previously missing from the PDF).
  doc.setFont("helvetica", "bold");
  doc.text("Fuel Pricing:", 15, y);
  y += 8;
  doc.setFont("helvetica", "normal");
  for (const ft of fuelTypes) {
    const label = getFuelLabel(ft);
    const code = getFuelCode(ft);
    const price = getPriceForType(state, ft, cloudFuelTypes);
    doc.text(
      `${label} (${code}): ${currencySymbol} ${formatNumber(price)}/L`,
      20,
      y,
    );
    y += 7;
  }
  y += 8;

  // Daily Expenses — each expense item (previously missing from the PDF).
  if (state.expenses && state.expenses.length > 0) {
    if (y > 250) {
      doc.addPage();
      y = 20;
    }
    doc.setFont("helvetica", "bold");
    doc.text("Daily Expenses:", 15, y);
    y += 8;
    doc.setFont("helvetica", "normal");
    const expHeaders = ["Description", `Amount (${currencySymbol})`];
    const expData = state.expenses.map((e: any) => [
      e.desc || e.description || "—",
      formatNumber(e.amount || 0),
    ]);
    autoTable(doc, {
      startY: y,
      head: [expHeaders],
      body: expData,
      theme: "striped",
      headStyles: { fillColor: [180, 53, 53] },
    });
    y = (doc as any).lastAutoTable.finalY + 10;
    const totalExp =
      state.summary?.totalExpenses ??
      state.expenses.reduce((sum: number, e: any) => sum + (e.amount || 0), 0);
    doc.setFont("helvetica", "bold");
    doc.text(
      `Total Expenses: ${currencySymbol} ${formatNumber(totalExp, 2)}`,
      15,
      y,
    );
    y += 12;
  }

  // Till/Mobile Payment (previously missing from the PDF).
  doc.setFont("helvetica", "bold");
  doc.text(
    `Till/Mobile Payment: ${currencySymbol} ${formatNumber(state.tillPayment || 0, 2)}`,
    15,
    y,
  );

  doc.save("Fuel_Sales_Report.pdf");
}

export async function exportSalesExcel(state: any) {
  const wb = XLSX.utils.book_new();
  // WORLDWIDE: derive the currency symbol from the company/station currency.
  const currencySymbol = getCurrencySymbol(state.companyData?.currency);

  // DYNAMIC: one sheet per configured fuel type (was hardcoded Petrol/Diesel).
  const cloudFuelTypes = await loadFuelTypesForExport();
  const fuelTypes = deriveFuelTypes(state, cloudFuelTypes);
  for (const ft of fuelTypes) {
    const pumps = getPumpsForType(state, ft);
    if (!pumps || pumps.length === 0) continue;
    const label = getFuelLabel(ft);
    const sheetData = [
      [
        "Pump ID",
        `Opening (${currencySymbol})`,
        `Closing (${currencySymbol})`,
        "Opening (L)",
        "Closing (L)",
        "Sales (L)",
        `Sales (${currencySymbol})`,
      ],
      ...pumps.map((p: any) => [
        p.id,
        p.openingKsh,
        p.closingKsh,
        p.openingL,
        p.closingL,
        p.salesL,
        p.salesKsh,
      ]),
    ];
    const ws = XLSX.utils.aoa_to_sheet(sheetData);
    // Excel sheet names: max 31 chars, no special chars.
    const sheetName = `${label} Pumps`.slice(0, 31);
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
  }

  // Add summary sheet — dynamic per fuel type
  if (state.summary) {
    const salesByType =
      (state.summary.salesByType as Record<string, number>) || {};
    const summaryRows: (string | number)[][] = [["Daily Summary"]];
    for (const ft of fuelTypes) {
      const label = getFuelLabel(ft);
      const sales = salesByType[ft] ?? 0;
      summaryRows.push([`Total ${label} Sales`, sales]);
    }
    summaryRows.push(["Total Revenue", state.summary.totalRevenue ?? 0]);
    summaryRows.push(["Cash In Hand", state.summary.cashInHand ?? 0]);
    summaryRows.push(["Total Expenses", state.summary.totalExpenses ?? 0]);
    summaryRows.push(["Net Income", state.summary.netIncome ?? 0]);
    summaryRows.push([]);
    summaryRows.push(["Till/Mobile Payment", state.tillPayment ?? 0]);
    const summaryWS = XLSX.utils.aoa_to_sheet(summaryRows);
    XLSX.utils.book_append_sheet(wb, summaryWS, "Summary");
  }

  // Fuel Tank Inventory sheet — one row per configured fuel type (previously
  // missing from the Excel export).
  const tankRows: (string | number)[][] = [
    ["Fuel Tank Inventory"],
    ["Fuel Type", "Code", "Opening (L)", "Closing (L)"],
  ];
  for (const ft of fuelTypes) {
    const label = getFuelLabel(ft);
    const code = getFuelCode(ft);
    const tv = getTankForType(state, ft);
    tankRows.push([label, code, tv.opening, tv.closing]);
  }
  const tankWS = XLSX.utils.aoa_to_sheet(tankRows);
  XLSX.utils.book_append_sheet(wb, tankWS, "Tank Inventory");

  // Fuel Pricing sheet (previously missing from Excel).
  const priceRows: (string | number)[][] = [
    ["Fuel Pricing"],
    ["Fuel Type", "Code", `Price (${currencySymbol}/L)`],
  ];
  for (const ft of fuelTypes) {
    const label = getFuelLabel(ft);
    const code = getFuelCode(ft);
    const price = getPriceForType(state, ft, cloudFuelTypes);
    priceRows.push([label, code, price]);
  }
  const priceWS = XLSX.utils.aoa_to_sheet(priceRows);
  XLSX.utils.book_append_sheet(wb, priceWS, "Fuel Pricing");

  // Daily Expenses sheet — each expense item (previously missing from Excel).
  if (state.expenses && state.expenses.length > 0) {
    const expRows: (string | number)[][] = [
      ["Daily Expenses"],
      ["Description", `Amount (${currencySymbol})`],
      ...state.expenses.map((e: any) => [
        e.desc || e.description || "—",
        e.amount || 0,
      ]),
      [],
      [
        "Total Expenses",
        state.expenses.reduce(
          (sum: number, e: any) => sum + (e.amount || 0),
          0,
        ),
      ],
    ];
    const expWS = XLSX.utils.aoa_to_sheet(expRows);
    XLSX.utils.book_append_sheet(wb, expWS, "Expenses");
  }

  // Add footer info sheet
  const footerData = [
    ["Report Information"],
    [],
    [
      `Company: ${state.companyData?.name || state.companyData?.companyName || "Fuel Station"}`,
    ],
    [`Generated: ${new Date().toLocaleDateString()}`],
  ];
  const footerWS = XLSX.utils.aoa_to_sheet(footerData);
  XLSX.utils.book_append_sheet(wb, footerWS, "Report Info");

  XLSX.writeFile(wb, "Fuel_Sales_Report.xlsx");
}

export async function exportSalesTXT(state: any) {
  // WORLDWIDE: derive the currency symbol from the company/station currency.
  const currencySymbol = getCurrencySymbol(state.companyData?.currency);
  let txt = `=== ${state.companyData?.name || state.companyData?.companyName || "Fuel Station"} ===\nFuel Sales Report\n\n`;
  txt += `Date: ${state.salesDate}\nShift: ${state.shift}\n\n`;

  // DYNAMIC: tank inventory + pricing + pumps per configured fuel type.
  const cloudFuelTypes = await loadFuelTypesForExport();
  const fuelTypes = deriveFuelTypes(state, cloudFuelTypes);

  txt += `Fuel Tank Inventory:\n`;
  for (const ft of fuelTypes) {
    const label = getFuelLabel(ft);
    const code = getFuelCode(ft);
    const tv = getTankForType(state, ft);
    txt += `${label} (${code}) Tank: Opening: ${formatNumber(tv.opening)} L, Closing: ${formatNumber(tv.closing)} L\n`;
  }
  txt += "\n";

  txt += `Fuel Pricing:\n`;
  for (const ft of fuelTypes) {
    const label = getFuelLabel(ft);
    const code = getFuelCode(ft);
    const price = getPriceForType(state, ft, cloudFuelTypes);
    txt += `${label} (${code}): ${currencySymbol} ${formatNumber(price)}/L\n`;
  }
  txt += "\n";

  for (const ft of fuelTypes) {
    const pumps = getPumpsForType(state, ft);
    if (!pumps || pumps.length === 0) continue;
    const label = getFuelLabel(ft);
    const code = getFuelCode(ft);
    txt += `${label} (${code}) Pumps:\n`;
    txt += pumps
      .map(
        (p: any) =>
          `${p.id}: Sales: ${formatNumber(p.salesL)} L, ${currencySymbol} ${formatNumber(p.salesKsh)}`,
      )
      .join("\n");
    txt += "\n\n";
  }

  if (state.expenses && state.expenses.length > 0) {
    txt += `Daily Expenses:\n`;
    txt += state.expenses
      .map((e: any) => `${e.desc}: ${currencySymbol} ${formatNumber(e.amount)}`)
      .join("\n");
    txt += "\n\n";
  }

  txt += `Till/Mobile Payment: ${currencySymbol} ${formatNumber(state.tillPayment)}\n\n`;

  if (state.summary) {
    txt += `Daily Summary:\n`;
    const salesByType =
      (state.summary.salesByType as Record<string, number>) || {};
    for (const ft of fuelTypes) {
      const label = getFuelLabel(ft);
      const sales = salesByType[ft] ?? 0;
      txt += `Total ${label} Sales: ${currencySymbol} ${formatNumber(sales, 2)}\n`;
    }
    txt += `Total Revenue: ${currencySymbol} ${formatNumber(state.summary.totalRevenue, 2)}\n`;
    txt += `Till/Mobile Payment: ${currencySymbol} ${formatNumber(state.tillPayment, 2)}\n`;
    txt += `Cash In Hand: ${currencySymbol} ${formatNumber(state.summary.cashInHand, 2)}\n`;
    txt += `Total Expenses: ${currencySymbol} ${formatNumber(state.summary.totalExpenses, 2)}\n`;
    txt += `Net Income: ${currencySymbol} ${formatNumber(state.summary.netIncome, 2)}`;
  }

  const blob = new Blob([txt], { type: "text/plain" });
  saveAs(blob, "Fuel_Sales_Report.txt");
}

// Enhanced Invoice Export Functions - Matching CAR HIRE INVOICE Format Exactly
export async function exportInvoicePDF(invoiceData: any) {
  const doc = new jsPDF();

  let y = 20;

  // WORLDWIDE: derive the currency symbol (€/$/KSh/…) from the company/station
  // currency instead of the previously hardcoded "Ksh".
  const currencySymbol = getCurrencySymbol(
    invoiceData.companyData?.currency || invoiceData.currency,
  );

  // Company logo at the top-left (max 50x30). Logos are stored as Supabase
  // Storage public URLs — loadLogoAsDataURL fetches + converts to base64 so
  // jsPDF can embed them. Data URLs are used directly.
  if (invoiceData.companyData?.logo) {
    const logoY = await addLogoToPDF(
      doc,
      invoiceData.companyData.logo,
      15,
      10,
      50,
      30,
    );
    if (logoY > 10) y = logoY;
  }

  // INVOICE title (after logo, before company info)
  doc.setFontSize(24);
  doc.setFont("helvetica", "bold");
  doc.setTextColor("#000000");
  doc.text("INVOICE", 15, y);
  y += 15;

  // Company name (only if provided by user - NO DEFAULTS)
  if (invoiceData.companyData?.name) {
    doc.setFontSize(16);
    doc.setFont("helvetica", "bold");
    doc.text(invoiceData.companyData.name, 15, y);
    y += 10;
  }

  // P.O. Box and Contacts on the same line (only if provided)
  doc.setFontSize(11);
  doc.setFont("helvetica", "normal");
  let contactLine = "";
  if (invoiceData.companyData?.poBox) {
    contactLine += `P.O. Box: ${invoiceData.companyData.poBox}`;
  }
  if (invoiceData.companyData?.contacts) {
    if (contactLine) contactLine += " ";
    contactLine += invoiceData.companyData.contacts;
  }
  if (contactLine) {
    doc.text(contactLine, 15, y);
    y += 8;
  }

  // Email (only if provided)
  if (invoiceData.companyData?.email) {
    doc.text(invoiceData.companyData.email, 15, y);
    y += 8;
  }

  y += 10;

  // Bill To section
  doc.setFont("helvetica", "bold");
  doc.text("Bill To:", 15, y);
  y += 8;

  doc.setFont("helvetica", "normal");
  if (invoiceData.customerName) {
    doc.text(invoiceData.customerName, 15, y);
    y += 6;
  }

  // Invoice details on the right
  const rightX = 120;
  let rightY = y - 20;
  doc.setFont("helvetica", "bold");
  doc.text("Invoice #:", rightX, rightY);
  doc.setFont("helvetica", "normal");
  doc.text(invoiceData.invoiceNumber || "", rightX + 25, rightY);
  rightY += 8;

  doc.setFont("helvetica", "bold");
  doc.text("Date:", rightX, rightY);
  doc.setFont("helvetica", "normal");
  doc.text(invoiceData.invoiceDate || "", rightX + 15, rightY);

  y += 15;

  // Items table with customizable quantity header
  if (invoiceData.invoiceItems && invoiceData.invoiceItems.length > 0) {
    const quantityHeader = invoiceData.quantityLabel || "Qty (DAYS)";
    const headers = ["Description", quantityHeader, "Unit Price", "Total"];
    const data = invoiceData.invoiceItems.map((item: any) => [
      item.desc || "",
      item.qty || 0,
      `${currencySymbol}${formatNumber(item.price, 0)}`,
      `${currencySymbol}${formatNumber(item.total, 0)}`,
    ]);

    autoTable(doc, {
      startY: y,
      head: [headers],
      body: data,
      theme: "plain",
      headStyles: {
        fillColor: false,
        textColor: [0, 0, 0],
        fontSize: 11,
        fontStyle: "bold",
        lineWidth: 0.1,
        lineColor: [0, 0, 0],
      },
      bodyStyles: {
        fontSize: 10,
        lineWidth: 0.1,
        lineColor: [0, 0, 0],
      },
      columnStyles: {
        0: { cellWidth: 80 },
        1: { cellWidth: 30, halign: "center" },
        2: { cellWidth: 40, halign: "right" },
        3: { cellWidth: 40, halign: "right" },
      },
    });

    y = (doc as any).lastAutoTable.finalY + 15;
  }

  // Total Due with leading space (as in sample)
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.text(
    ` Total Due: ${currencySymbol}${formatNumber(invoiceData.totalDue || 0, 0)}`,
    120,
    y,
  );
  y += 20;

  // Payment information section
  doc.setFont("helvetica", "bold");
  doc.text("Payment Should Be Made Through", 15, y);
  y += 10;

  doc.setFont("helvetica", "normal");
  // Bank details each on a new line (only if provided)
  if (invoiceData.companyData?.bankName) {
    doc.text(`BANK: ${invoiceData.companyData.bankName}`, 15, y);
    y += 8;
  }
  if (invoiceData.companyData?.branchName) {
    doc.text(`BRANCH: ${invoiceData.companyData.branchName}`, 15, y);
    y += 8;
  }
  if (invoiceData.companyData?.accountHolder) {
    doc.text(invoiceData.companyData.accountHolder, 15, y);
    y += 8;
  }
  if (invoiceData.companyData?.accountNumber) {
    doc.text(`ACCOUNT NO: ${invoiceData.companyData.accountNumber}`, 15, y);
    y += 8;
  }

  y += 15;

  // Signature line
  doc.text("Signature:………………………….", 15, y);

  // Save with descriptive filename
  const filename = `Invoice_${invoiceData.invoiceNumber}_${invoiceData.customerName?.replace(/\s+/g, "_") || "Customer"}.pdf`;
  doc.save(filename);
}

export function exportInvoiceExcel(invoiceData: any) {
  const wb = XLSX.utils.book_new();

  // WORLDWIDE: derive the currency symbol from the company/station currency.
  const currencySymbol = getCurrencySymbol(
    invoiceData.companyData?.currency || invoiceData.currency,
  );

  // Invoice header data matching exact format
  const headerData = [["INVOICE"], []];

  // Company info (only if provided)
  if (invoiceData.companyData?.name) {
    headerData.push([invoiceData.companyData.name]);
  }

  // P.O. Box and contacts on same line
  let contactLine = "";
  if (invoiceData.companyData?.poBox) {
    contactLine += `P.O. Box: ${invoiceData.companyData.poBox}`;
  }
  if (invoiceData.companyData?.contacts) {
    if (contactLine) contactLine += " ";
    contactLine += invoiceData.companyData.contacts;
  }
  if (contactLine) {
    headerData.push([contactLine]);
  }

  if (invoiceData.companyData?.email) {
    headerData.push([invoiceData.companyData.email]);
  }

  headerData.push([]);
  headerData.push(["Bill To:", invoiceData.customerName || ""]);
  headerData.push([`Invoice #: ${invoiceData.invoiceNumber}`]);
  headerData.push([`Date: ${invoiceData.invoiceDate}`]);
  headerData.push([]);

  // Invoice items data
  const quantityHeader = invoiceData.quantityLabel || "Qty (DAYS)";
  const itemsData =
    invoiceData.invoiceItems?.length > 0
      ? [
          ["Description", quantityHeader, "Unit Price", "Total"],
          ...invoiceData.invoiceItems.map((item: any) => [
            item.desc || "",
            item.qty || 0,
            `${currencySymbol}${formatNumber(item.price, 0)}`,
            `${currencySymbol}${formatNumber(item.total, 0)}`,
          ]),
        ]
      : [["No items added"]];

  // Totals data
  const totalsData = [
    [],
    [
      ` Total Due: ${currencySymbol}${formatNumber(invoiceData.totalDue || 0, 0)}`,
    ],
    [],
    ["Payment Should Be Made Through"],
  ];

  // Bank details (only if provided)
  if (invoiceData.companyData?.bankName) {
    totalsData.push([`BANK: ${invoiceData.companyData.bankName}`]);
  }
  if (invoiceData.companyData?.branchName) {
    totalsData.push([`BRANCH: ${invoiceData.companyData.branchName}`]);
  }
  if (invoiceData.companyData?.accountHolder) {
    totalsData.push([invoiceData.companyData.accountHolder]);
  }
  if (invoiceData.companyData?.accountNumber) {
    totalsData.push([`ACCOUNT NO: ${invoiceData.companyData.accountNumber}`]);
  }

  totalsData.push([]);
  totalsData.push(["Signature:…………………………."]);

  // Combine all data
  const allData = [...headerData, ...itemsData, ...totalsData];

  const ws = XLSX.utils.aoa_to_sheet(allData);

  // Set column widths
  ws["!cols"] = [
    { width: 25 }, // Description
    { width: 12 }, // Quantity
    { width: 18 }, // Unit Price
    { width: 18 }, // Total
  ];

  XLSX.utils.book_append_sheet(wb, ws, "Invoice");

  // Save with descriptive filename
  const filename = `Invoice_${invoiceData.invoiceNumber}_${invoiceData.customerName?.replace(/\s+/g, "_") || "Customer"}.xlsx`;
  XLSX.writeFile(wb, filename);
}

export function exportInvoiceTXT(invoiceData: any) {
  let txt = "";

  // WORLDWIDE: derive the currency symbol from the company/station currency.
  const currencySymbol = getCurrencySymbol(
    invoiceData.companyData?.currency || invoiceData.currency,
  );

  // INVOICE header
  txt += "INVOICE\n";

  // Company info (only if provided)
  if (invoiceData.companyData?.name) {
    txt += `${invoiceData.companyData.name}\n`;
  }
  if (invoiceData.companyData?.logo) {
    txt += `[Company Logo: ${invoiceData.companyData.logo}]\n`;
  }

  // P.O. Box and contacts on same line
  let contactLine = "";
  if (invoiceData.companyData?.poBox) {
    contactLine += `P.O. Box: ${invoiceData.companyData.poBox}`;
  }
  if (invoiceData.companyData?.contacts) {
    if (contactLine) contactLine += " ";
    contactLine += invoiceData.companyData.contacts;
  }
  if (contactLine) {
    txt += `${contactLine}\n`;
  }

  if (invoiceData.companyData?.email) {
    txt += `${invoiceData.companyData.email}\n`;
  }

  txt += "\n";

  // Customer and invoice details
  txt += `Bill To: ${invoiceData.customerName || ""}\n`;
  txt += `Invoice #: ${invoiceData.invoiceNumber}\n`;
  txt += `Date: ${invoiceData.invoiceDate}\n\n`;

  // Items table
  const quantityHeader = invoiceData.quantityLabel || "Qty (DAYS)";
  txt += `${"Description".padEnd(40)} ${quantityHeader.padEnd(12)} ${"Unit Price".padEnd(15)} ${"Total".padEnd(15)}\n`;
  txt += `${"-".repeat(85)}\n`;

  if (invoiceData.invoiceItems?.length > 0) {
    invoiceData.invoiceItems.forEach((item: any) => {
      const desc = (item.desc || "").padEnd(40);
      const qty = (item.qty || 0).toString().padEnd(12);
      const price = `${currencySymbol}${formatNumber(item.price, 0)}`.padEnd(
        15,
      );
      const total = `${currencySymbol}${formatNumber(item.total, 0)}`.padEnd(
        15,
      );
      txt += `${desc} ${qty} ${price} ${total}\n`;
    });
  } else {
    txt += `No items added\n`;
  }

  txt += `\n`;

  // Total with leading space
  txt += ` Total Due: ${currencySymbol}${formatNumber(invoiceData.totalDue || 0, 0)}\n\n`;

  // Payment information
  txt += `Payment Should Be Made Through\n`;

  // Bank details (only if provided)
  if (invoiceData.companyData?.bankName) {
    txt += `BANK: ${invoiceData.companyData.bankName}\n`;
  }
  if (invoiceData.companyData?.branchName) {
    txt += `BRANCH: ${invoiceData.companyData.branchName}\n`;
  }
  if (invoiceData.companyData?.accountHolder) {
    txt += `${invoiceData.companyData.accountHolder}\n`;
  }
  if (invoiceData.companyData?.accountNumber) {
    txt += `ACCOUNT NO: ${invoiceData.companyData.accountNumber}\n`;
  }

  txt += `\nSignature:………………………….`;

  const blob = new Blob([txt], { type: "text/plain;charset=utf-8" });
  const filename = `Invoice_${invoiceData.invoiceNumber}_${invoiceData.customerName?.replace(/\s+/g, "_") || "Customer"}.txt`;
  saveAs(blob, filename);
}
