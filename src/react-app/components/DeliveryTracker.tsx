import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import {
  Plus,
  DollarSign,
  ArrowRight,
  Columns,
  Save,
  Trash2,
  ChevronLeft,
  ChevronRight,
  X,
} from "lucide-react";
import { useFuel } from "@/react-app/context/FuelContext";
import { useStationFuelTypes } from "@/react-app/hooks/useStationFuelTypes";
import { useAuth } from "@/react-app/context/AuthContext";
import { useStations } from "@/react-app/context/StationContext";
import SignatureCanvas from "@/react-app/components/SignatureCanvas";
import ExportDropdown from "@/react-app/components/ExportDropdown";
import {
  exportDeliveryPDF,
  exportDeliveryExcel,
  exportDeliveryTXT,
} from "@/react-app/utils/exportUtils";
import { formatNumber } from "@/react-app/utils/formatUtils";
import { switchToTab } from "@/react-app/lib/mpesa-integration-service";
import {
  getCurrencySymbol,
  resolveCurrencySymbol,
} from "@/react-app/lib/currency";
import cloudStorageService from "@/react-app/lib/cloud-storage-service";
import { normalizeFuelType, getFuelLabel } from "@/react-app/config/pricing";
import { toastError } from "@/react-app/lib/toast";

/** Generate a unique row id (stable across devices/sessions). */
function rowId(): string {
  return `dlv-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export default function DeliveryTracker() {
  const { state, dispatch, syncPriceToFuelTypes } = useFuel();
  const { user } = useAuth();
  const { currentStation } = useStations();
  const stationId = currentStation?.id;
  const currencySymbol = resolveCurrencySymbol(
    state.companyData?.currency,
    currentStation?.currency,
  );
  const fuelTypeApi = useStationFuelTypes(stationId);

  // ─── Signatures (cross-device cloud-persisted) ───
  const SIG_KEY = "delivery_signatures";
  const [managerSignature, setManagerSignature] = useState("");
  const [directorSignature, setDirectorSignature] = useState("");
  // Refs to guard against real-time echo overwriting in-progress edits
  const managerSignatureRef = useRef("");
  const directorSignatureRef = useRef("");
  managerSignatureRef.current = managerSignature;
  directorSignatureRef.current = directorSignature;

  // Load signatures from cloud on mount; seed from in-memory cache for
  // instant first render. Save back to cloud whenever they change.
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      const cloud = await cloudStorageService.get<{
        manager?: string;
        director?: string;
      }>(SIG_KEY, stationId);
      if (!cancelled && cloud) {
        if (cloud.manager) setManagerSignature(cloud.manager);
        if (cloud.director) setDirectorSignature(cloud.director);
      }
    })();
    const unsub = cloudStorageService.subscribe<{
      manager?: string;
      director?: string;
    }>(SIG_KEY, stationId, (val) => {
      // Guard against echo: skip if the value matches what we just saved
      // (the real-time event echoes back our own write).
      if (!val) return;
      if (
        val.manager !== undefined &&
        val.manager !== managerSignatureRef.current
      ) {
        setManagerSignature(val.manager);
      }
      if (
        val.director !== undefined &&
        val.director !== directorSignatureRef.current
      ) {
        setDirectorSignature(val.director);
      }
    });
    return () => {
      cancelled = true;
      unsub();
    };
  }, [user, stationId]);

  const saveSignatures = useCallback(
    (mgr: string, dir: string) => {
      if (!user) return;
      cloudStorageService
        .set(SIG_KEY, { manager: mgr, director: dir }, stationId)
        .catch(() => {});
    },
    [user, stationId],
  );

  const handleManagerSig = useCallback(
    (data: string) => {
      setManagerSignature(data);
      saveSignatures(data, directorSignature);
    },
    [directorSignature, saveSignatures],
  );
  const handleDirectorSig = useCallback(
    (data: string) => {
      setDirectorSignature(data);
      saveSignatures(managerSignature, data);
    },
    [managerSignature, saveSignatures],
  );

  // ─── Modal state (replaces prompt/alert) ───
  const [paymentModal, setPaymentModal] = useState(false);
  const [coDebtModal, setCoDebtModal] = useState(false);
  const [columnModal, setColumnModal] = useState(false);
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentName, setPaymentName] = useState("");
  const [coDebtAmount, setCoDebtAmount] = useState("");
  const [columnName, setColumnName] = useState("");

  // ─── Row filter (functional header dropdowns) ───
  const [filterDate, setFilterDate] = useState("");
  const [filterFuel, setFilterFuel] = useState("");

  // ─── Station fuel types (replaces hardcoded Petrol/Diesel) ───
  // Uses fuelTypeApi.activeFuelTypes (from fuel_types_config cloud key) as
  // the primary source — same source the Dashboard + POS use — so the
  // dropdown is always in sync with the station's configured fuels.
  const stationFuelOptions = useMemo<string[]>(() => {
    const fromApi = (fuelTypeApi.activeFuelTypes || [])
      .map((ft) => getFuelLabel(ft.name) || ft.localName || ft.name || "")
      .filter((label): label is string => Boolean(label));
    const fromState = (state.fuelTypes || [])
      .filter((ft) => ft.active !== false)
      .map((ft) => ft.localName || ft.name || "")
      .filter((label): label is string => Boolean(label));
    const unique = [...new Set([...fromApi, ...fromState])];
    if (unique.length > 0) return unique;
    // Fallback to the two legacy fuels if no fuel types configured yet
    return ["Super Petrol", "Diesel"];
  }, [fuelTypeApi.activeFuelTypes, state.fuelTypes]);

  const defaultFuel = stationFuelOptions[0] || "Super Petrol";

  const addDeliveryRow = () => {
    const newRow: any = { _id: rowId() };
    state.deliveryData.columns.forEach((col) => {
      switch (col.key) {
        case "date":
          newRow.date = new Date().toISOString().split("T")[0];
          break;
        case "reg":
          newRow.reg = "";
          break;
        case "fuel":
          newRow.fuel = defaultFuel;
          break;
        case "litres":
          newRow.litres = 0;
          break;
        case "amount":
          newRow.amount = 0;
          break;
        case "name":
          newRow.name = "";
          break;
        case "debt":
          newRow.debt = 0;
          break;
        default:
          newRow[col.key] = "";
          break;
      }
    });

    const updatedData = {
      ...state.deliveryData,
      rows: [...state.deliveryData.rows, newRow],
    };

    dispatch({ type: "SET_DELIVERY_DATA", payload: updatedData });
    updateDeliveryTotals(updatedData);
  };

  const submitPayment = () => {
    const amount = parseFloat(paymentAmount) || 0;
    if (amount <= 0) {
      setPaymentModal(false);
      return;
    }
    const name = paymentName.trim();

    const newRow: any = { _id: rowId() };
    state.deliveryData.columns.forEach((col) => {
      switch (col.key) {
        case "date":
          newRow.date = new Date().toISOString().split("T")[0];
          break;
        case "reg":
          newRow.reg = "PAYMENT";
          break;
        case "fuel":
          newRow.fuel = "-";
          break;
        case "litres":
          newRow.litres = 0;
          break;
        case "amount":
          newRow.amount = -amount;
          break;
        case "name":
          newRow.name = name;
          break;
        case "debt":
          newRow.debt = -amount;
          break;
        default:
          newRow[col.key] = "";
          break;
      }
    });

    const updatedData = {
      ...state.deliveryData,
      rows: [...state.deliveryData.rows, newRow],
    };

    dispatch({ type: "SET_DELIVERY_DATA", payload: updatedData });
    updateDeliveryTotals(updatedData);
    setPaymentModal(false);
    setPaymentAmount("");
    setPaymentName("");
  };

  const submitCoDebt = () => {
    const amount = parseFloat(coDebtAmount) || 0;
    if (amount <= 0) {
      setCoDebtModal(false);
      return;
    }

    const newRow: any = { _id: rowId() };
    state.deliveryData.columns.forEach((col) => {
      switch (col.key) {
        case "date":
          newRow.date = "C/O";
          break;
        case "reg":
          newRow.reg = "Carried Over Debt";
          break;
        case "fuel":
          newRow.fuel = "Carried Over Debt";
          break;
        case "litres":
          newRow.litres = 0;
          break;
        case "amount":
          newRow.amount = amount;
          break;
        case "name":
          newRow.name = "Carried Over Debt";
          break;
        case "debt":
          newRow.debt = amount;
          break;
        default:
          newRow[col.key] = "";
          break;
      }
    });

    const updatedData = {
      ...state.deliveryData,
      rows: [...state.deliveryData.rows, newRow],
    };

    dispatch({ type: "SET_DELIVERY_DATA", payload: updatedData });
    updateDeliveryTotals(updatedData);
    setCoDebtModal(false);
    setCoDebtAmount("");
  };

  const submitColumn = () => {
    const colName = columnName.trim();
    if (!colName) {
      setColumnModal(false);
      return;
    }

    const key = colName.toLowerCase().replace(/\s+/g, "");
    const newColumn = { key, label: colName, editable: true };

    const updatedData = {
      ...state.deliveryData,
      columns: [...state.deliveryData.columns, newColumn],
    };

    dispatch({ type: "SET_DELIVERY_DATA", payload: updatedData });
    setColumnModal(false);
    setColumnName("");
  };

  const moveColumnLeft = (columnIndex: number) => {
    if (columnIndex === 0) return; // Can't move first column left

    const updatedColumns = [...state.deliveryData.columns];
    const temp = updatedColumns[columnIndex];
    updatedColumns[columnIndex] = updatedColumns[columnIndex - 1];
    updatedColumns[columnIndex - 1] = temp;

    const updatedData = {
      ...state.deliveryData,
      columns: updatedColumns,
    };

    dispatch({ type: "SET_DELIVERY_DATA", payload: updatedData });
  };

  const moveColumnRight = (columnIndex: number) => {
    if (columnIndex === state.deliveryData.columns.length - 1) return; // Can't move last column right

    const updatedColumns = [...state.deliveryData.columns];
    const temp = updatedColumns[columnIndex];
    updatedColumns[columnIndex] = updatedColumns[columnIndex + 1];
    updatedColumns[columnIndex + 1] = temp;

    const updatedData = {
      ...state.deliveryData,
      columns: updatedColumns,
    };

    dispatch({ type: "SET_DELIVERY_DATA", payload: updatedData });
  };

  const deleteColumn = (columnIndex: number) => {
    const column = state.deliveryData.columns[columnIndex];

    // Prevent deletion of essential columns
    const essentialColumns = [
      "date",
      "reg",
      "fuel",
      "litres",
      "amount",
      "name",
      "debt",
    ];
    if (essentialColumns.includes(column.key)) {
      toastError(
        `Cannot delete the "${column.label}" column as it is essential for calculations.`,
      );
      return;
    }

    if (
      confirm(
        `Delete the "${column.label}" column? This will remove all data in this column.`,
      )
    ) {
      const updatedColumns = [...state.deliveryData.columns];
      updatedColumns.splice(columnIndex, 1);

      // Remove the column data from all rows
      const updatedRows = state.deliveryData.rows.map((row) => {
        const newRow = { ...row };
        delete newRow[column.key];
        return newRow;
      });

      const updatedData = {
        ...state.deliveryData,
        columns: updatedColumns,
        rows: updatedRows,
      };

      dispatch({ type: "SET_DELIVERY_DATA", payload: updatedData });
    }
  };

  const updateCell = (rowIndex: number, field: string, value: any) => {
    const updatedRows = [...state.deliveryData.rows];
    const row = updatedRows[rowIndex] as any;

    if (field === "litres" || field === "fuel") {
      const litres = parseFloat(value) || 0;
      const fuel = field === "fuel" ? value : row.fuel;
      // Use the unified bus-fresh price so delivery amounts match the station's
      // current fuel price. normalizeFuelType maps both legacy ("Petrol") and
      // canonical ("Super Petrol") spellings to the same key.
      const canonical = normalizeFuelType(fuel);
      const price =
        fuelTypeApi.getPriceFor(fuel) ??
        (canonical === "diesel"
          ? state.dieselPrice
          : canonical === "kerosene"
            ? state.kerosenePrice
            : state.petrolPrice);
      const amount = litres * (price || 0);

      row[field] = field === "litres" ? litres : value;
      row.amount = amount;
    } else if (field === "reg") {
      row.reg = value;
      if (value === "PAYMENT" || value === "Carried Over Debt") {
        row.fuel = "-";
      }
    } else {
      row[field] = value;
    }

    // Recalculate cumulative debt
    let cumulativeSum = 0;
    for (let i = 0; i < updatedRows.length; i++) {
      cumulativeSum += updatedRows[i].amount || 0;
      updatedRows[i].debt = cumulativeSum;
    }

    const updatedData = {
      ...state.deliveryData,
      rows: updatedRows,
    };

    dispatch({ type: "SET_DELIVERY_DATA", payload: updatedData });
    updateDeliveryTotals(updatedData);
  };

  const deleteRow = (index: number) => {
    if (confirm("Delete this row?")) {
      const updatedRows = [...state.deliveryData.rows];
      updatedRows.splice(index, 1);

      // Recalculate cumulative debt
      let cumulativeSum = 0;
      for (let i = 0; i < updatedRows.length; i++) {
        cumulativeSum += updatedRows[i].amount || 0;
        updatedRows[i].debt = cumulativeSum;
      }

      const updatedData = {
        ...state.deliveryData,
        rows: updatedRows,
      };

      dispatch({ type: "SET_DELIVERY_DATA", payload: updatedData });
      updateDeliveryTotals(updatedData);
    }
  };

  const updateDeliveryTotals = (deliveryData: any) => {
    const totalSupplied = deliveryData.rows
      .filter((r: any) => r.reg !== "PAYMENT" && r.reg !== "Carried Over Debt")
      .reduce((sum: number, r: any) => sum + (r.litres || 0), 0);

    const totalPayments = deliveryData.rows
      .filter((r: any) => r.reg === "PAYMENT")
      .reduce((sum: number, r: any) => sum + Math.abs(r.amount || 0), 0);

    const balanceDue =
      deliveryData.rows.length > 0
        ? deliveryData.rows[deliveryData.rows.length - 1].debt || 0
        : 0;

    const updatedData = {
      ...deliveryData,
      totals: { totalSupplied, totalPayments, balanceDue },
    };

    dispatch({ type: "SET_DELIVERY_DATA", payload: updatedData });
  };

  const [toast, setToast] = useState("");

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(""), 3000);
  };

  const saveClient = () => {
    const name = state.deliveredTo.trim() || `Client_${Date.now()}`;
    const clientData = {
      ...state.deliveryData,
      deliveredTo: name,
      year: state.deliveryYear,
    };

    dispatch({
      type: "SET_CLIENTS",
      payload: { ...state.clients, [name]: clientData },
    });

    showToast(`Client "${name}" saved!`);
  };

  const loadClient = (name: string) => {
    const data = state.clients[name];
    if (!data) return;

    dispatch({ type: "SET_DELIVERY_DATA", payload: data });
    dispatch({
      type: "SET_DELIVERY_INFO",
      payload: {
        deliveredTo: data.deliveredTo,
        deliveryYear: data.year || new Date().getFullYear(),
      },
    });
  };

  const deleteClient = (name: string) => {
    if (confirm(`Delete client "${name}"?`)) {
      const updatedClients = { ...state.clients };
      delete updatedClients[name];
      dispatch({ type: "SET_CLIENTS", payload: updatedClients });
    }
  };

  const clearAllDelivery = () => {
    if (confirm("Clear all delivery data?")) {
      const clearedData = {
        ...state.deliveryData,
        rows: [],
      };

      dispatch({ type: "SET_DELIVERY_DATA", payload: clearedData });
      dispatch({
        type: "SET_DELIVERY_INFO",
        payload: { deliveredTo: "", totalOrder: "" },
      });
    }
  };

  const exportHandlers = {
    pdf: async () => {
      await exportDeliveryPDF(state);
    },
    excel: () => exportDeliveryExcel(state),
    txt: () => exportDeliveryTXT(state),
    whatsapp: () => {
      const data = getDeliveryData();
      const msg = `*${state.companyData.name}*\n\n*Fuel Delivery Report*\n\n${data}\n\n*CONTACTS:* ${state.companyData.contacts}\n*EMAIL:* ${state.companyData.email}`;
      const url = `https://wa.me/?text=${encodeURIComponent(msg)}`;
      window.open(url, "_blank");
    },
    email: () => {
      const data = getDeliveryData();
      const subject = `Fuel Delivery Report - ${state.deliveredTo || "Client"}`;
      const body = `${state.companyData.name}\n\nFuel Delivery Report\n\n${data}\n\nCONTACTS: ${state.companyData.contacts}\nEMAIL: ${state.companyData.email}`;
      window.location.href = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    },
  };

  const getDeliveryData = () => {
    const headers = state.deliveryData.columns.map((col) => col.label);
    const rows = state.deliveryData.rows
      .map((r) =>
        state.deliveryData.columns
          .map((col) => {
            if (col.key === "amount")
              return `${currencySymbol}${formatNumber(r.amount)}`;
            if (col.key === "debt")
              return `${currencySymbol}${formatNumber(r.debt)}`;
            return r[col.key] || "";
          })
          .join(" | "),
      )
      .join("\n");

    const priceLines = stationFuelOptions
      .map((label) => {
        const ft = fuelTypeApi.findFuelType(label);
        const price =
          ft?.price ??
          (label === "Super Petrol" || label === "Petrol"
            ? state.petrolPrice
            : label === "Diesel"
              ? state.dieselPrice
              : null);
        return price != null
          ? `${label} Price: ${currencySymbol} ${price} /L`
          : null;
      })
      .filter(Boolean)
      .join("\n");

    return `FUEL DELIVERED TO: ${state.deliveredTo || "Client"}\nTOTAL ORDER: ${state.totalOrder || "N/A"} Litres\nYEAR: ${state.deliveryYear}\n${priceLines}\n\n${headers.join(" | ")}\n${rows}\n\nTotal Supplied: ${formatNumber(state.deliveryData.totals.totalSupplied)} L\nTotal Payments: ${currencySymbol} ${formatNumber(state.deliveryData.totals.totalPayments)}\nBalance Due: ${currencySymbol} ${formatNumber(state.deliveryData.totals.balanceDue, 2)}`;
  };

  // Recalculate totals once on mount so cumulative debt is correct after a
  // cloud reload. Runs only once — updateDeliveryTotals is called inline by
  // every mutation handler for subsequent changes.
  const totalsInitialized = useRef(false);
  useEffect(() => {
    if (totalsInitialized.current) return;
    if (state.deliveryData.rows.length > 0) {
      totalsInitialized.current = true;
      updateDeliveryTotals(state.deliveryData);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.deliveryData.rows.length]);

  // Filter rows by the header date/fuel dropdowns. The index is preserved so
  // updateCell/deleteRow still operate on the correct row in the full array.
  const filteredRows = useMemo(() => {
    return state.deliveryData.rows
      .map((row, index) => ({ row, index }))
      .filter(({ row }) => {
        if (filterDate && row.date !== filterDate) return false;
        if (filterFuel && row.fuel !== filterFuel) return false;
        return true;
      });
  }, [state.deliveryData.rows, filterDate, filterFuel]);

  return (
    <div className="p-6 space-y-6">
      {/* Toast */}
      {toast && (
        <div className="fixed top-4 right-4 z-50 bg-green-600 text-white px-4 py-2 rounded-lg shadow-lg animate-fade-in">
          {toast}
        </div>
      )}

      {/* Header */}
      <div className="card">
        <div className="flex justify-between items-center mb-6 pb-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-2xl font-bold text-blue-900 dark:text-blue-200">
            Fuel Statement Report
          </h2>
          <div className="flex gap-2">
            <button
              onClick={() => switchToTab("suppliers")}
              className="px-3 py-1.5 rounded-lg text-sm font-medium bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200"
            >
              Suppliers
            </button>
            <button
              onClick={() => switchToTab("offloading")}
              className="px-3 py-1.5 rounded-lg text-sm font-medium bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200"
            >
              Offloading
            </button>
            <button
              onClick={() => switchToTab("pos")}
              className="px-3 py-1.5 rounded-lg text-sm font-medium bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200"
            >
              POS
            </button>
          </div>
        </div>

        {/* Quick Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          <div className="bg-white dark:bg-gray-800 rounded-xl p-3 border border-gray-200 dark:border-gray-700 shadow-sm">
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Total Entries
            </p>
            <p className="text-xl font-bold text-blue-600 dark:text-blue-400">
              {state.deliveryData?.rows?.length || 0}
            </p>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-xl p-3 border border-gray-200 dark:border-gray-700 shadow-sm">
            <p className="text-xs text-gray-500 dark:text-gray-400">Columns</p>
            <p className="text-xl font-bold text-emerald-600 dark:text-emerald-400">
              {state.deliveryData?.columns?.length || 0}
            </p>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-xl p-3 border border-gray-200 dark:border-gray-700 shadow-sm">
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Fuel Types
            </p>
            <p className="text-xl font-bold text-purple-600 dark:text-purple-400">
              {fuelTypeApi.activeFuelTypes.length}
            </p>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-xl p-3 border border-gray-200 dark:border-gray-700 shadow-sm">
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Signatures
            </p>
            <p className="text-xl font-bold text-amber-600 dark:text-amber-400">
              {(() => {
                try {
                  return Object.keys(
                    JSON.parse(localStorage.getItem(SIG_KEY) || "{}"),
                  ).length;
                } catch {
                  return 0;
                }
              })()}
            </p>
          </div>
        </div>

        {/* Form Fields */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4 mb-6">
          <div className="form-group">
            <label>Fuel Delivered To</label>
            <input
              type="text"
              value={state.deliveredTo}
              onChange={(e) =>
                dispatch({
                  type: "SET_DELIVERY_INFO",
                  payload: { deliveredTo: e.target.value },
                })
              }
              placeholder="Client Name"
            />
          </div>
          <div className="form-group">
            <label>Total Order</label>
            <input
              type="text"
              value={state.totalOrder}
              onChange={(e) =>
                dispatch({
                  type: "SET_DELIVERY_INFO",
                  payload: { totalOrder: e.target.value },
                })
              }
              placeholder="e.g. 50,000 Litres"
            />
          </div>
          <div className="form-group">
            <label>Year</label>
            <input
              type="number"
              value={state.deliveryYear ?? ""}
              onChange={(e) =>
                dispatch({
                  type: "SET_DELIVERY_INFO",
                  payload: { deliveryYear: parseInt(e.target.value) },
                })
              }
            />
          </div>
          <div className="form-group">
            <label>
              {fuelTypeApi.labelOf("Petrol")} Price ({currencySymbol}/L)
            </label>
            <input
              type="number"
              value={state.petrolPrice ?? ""}
              onChange={(e) => {
                const v = parseFloat(e.target.value);
                dispatch({
                  type: "SET_PRICES",
                  payload: { petrolPrice: v, pmsPrice: v },
                });
              }}
              step="0.1"
            />
          </div>
          <div className="form-group">
            <label>
              {fuelTypeApi.labelOf("Diesel")} Price ({currencySymbol}/L)
            </label>
            <input
              type="number"
              value={state.dieselPrice ?? ""}
              onChange={(e) => {
                const v = parseFloat(e.target.value);
                dispatch({
                  type: "SET_PRICES",
                  payload: { dieselPrice: v, agoPrice: v },
                });
              }}
              step="0.1"
            />
          </div>
          {/* Dynamic price inputs for extra fuel types (Kerosene, LPG,
              V-Power, etc.) — not limited to just Petrol/Diesel. */}
          {stationFuelOptions
            .filter(
              (label) => !["Super Petrol", "Petrol", "Diesel"].includes(label),
            )
            .map((label) => {
              const ft = fuelTypeApi.findFuelType(label);
              const priceVal = ft?.price ?? "";
              return (
                <div className="form-group" key={label}>
                  <label>
                    {label} Price ({currencySymbol}/L)
                  </label>
                  <input
                    type="number"
                    value={priceVal}
                    onChange={(e) => {
                      const v = parseFloat(e.target.value);
                      syncPriceToFuelTypes(label, v);
                    }}
                    step="0.1"
                  />
                </div>
              );
            })}
        </div>

        {/* Table */}
        <div className="table-container">
          <table>
            <thead>
              <tr>
                {state.deliveryData.columns.map((col, index) => (
                  <th key={col.key} className="relative">
                    <div className="flex flex-col gap-1">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold">{col.label}</span>
                        <div className="flex gap-1">
                          <button
                            onClick={() => moveColumnLeft(index)}
                            disabled={index === 0}
                            className="p-1 hover:bg-white/20 rounded disabled:opacity-30 disabled:cursor-not-allowed"
                            title="Move Left"
                          >
                            <ChevronLeft size={12} />
                          </button>
                          <button
                            onClick={() => moveColumnRight(index)}
                            disabled={
                              index === state.deliveryData.columns.length - 1
                            }
                            className="p-1 hover:bg-white/20 rounded disabled:opacity-30 disabled:cursor-not-allowed"
                            title="Move Right"
                          >
                            <ChevronRight size={12} />
                          </button>
                          <button
                            onClick={() => deleteColumn(index)}
                            className="p-1 hover:bg-red-500/20 rounded text-red-300 hover:text-red-100"
                            title="Delete Column"
                          >
                            <X size={12} />
                          </button>
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        {col.key === "date" && (
                          <input
                            type="date"
                            value={filterDate}
                            onChange={(e) => setFilterDate(e.target.value)}
                            className="text-xs bg-transparent border border-white/30 rounded px-1 flex-1"
                            title="Filter by date"
                          />
                        )}
                        {col.key === "fuel" && (
                          <select
                            value={filterFuel}
                            onChange={(e) => setFilterFuel(e.target.value)}
                            className="text-xs bg-transparent border border-white/30 rounded px-1 flex-1"
                            title="Filter by fuel type"
                          >
                            <option value="">All</option>
                            {stationFuelOptions.map((f) => (
                              <option key={f} value={f}>
                                {f}
                              </option>
                            ))}
                          </select>
                        )}
                      </div>
                    </div>
                  </th>
                ))}
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.map(({ row, index }) => (
                <tr key={row._id || index}>
                  {state.deliveryData.columns.map((col) => (
                    <td key={col.key}>
                      {col.key === "date" ? (
                        <input
                          type="date"
                          value={row.date || ""}
                          onChange={(e) =>
                            updateCell(index, col.key, e.target.value)
                          }
                          className="w-full bg-transparent border-none outline-none"
                        />
                      ) : col.key === "reg" ? (
                        <input
                          type="text"
                          value={row.reg || ""}
                          onChange={(e) =>
                            updateCell(index, col.key, e.target.value)
                          }
                          className="w-full bg-transparent border-none outline-none"
                        />
                      ) : col.key === "fuel" ? (
                        row.reg === "PAYMENT" ||
                        row.reg === "Carried Over Debt" ? (
                          <span>-</span>
                        ) : (
                          <select
                            value={row.fuel || defaultFuel}
                            onChange={(e) =>
                              updateCell(index, col.key, e.target.value)
                            }
                            className="w-full bg-transparent border-none outline-none"
                          >
                            {stationFuelOptions.map((f) => (
                              <option key={f} value={f}>
                                {f}
                              </option>
                            ))}
                          </select>
                        )
                      ) : col.key === "litres" ? (
                        <input
                          type="number"
                          value={row.litres || 0}
                          onChange={(e) =>
                            updateCell(index, col.key, e.target.value)
                          }
                          step="0.1"
                          className="w-full bg-transparent border-none outline-none"
                        />
                      ) : col.key === "amount" ? (
                        <input
                          type="number"
                          value={row.amount || 0}
                          onChange={(e) =>
                            updateCell(index, col.key, e.target.value)
                          }
                          step="0.01"
                          className="w-full bg-transparent border-none outline-none"
                        />
                      ) : col.key === "name" ? (
                        <input
                          type="text"
                          value={row.name || ""}
                          onChange={(e) =>
                            updateCell(index, col.key, e.target.value)
                          }
                          className="w-full bg-transparent border-none outline-none"
                        />
                      ) : col.key === "debt" ? (
                        <span>{formatNumber(row.debt || 0)}</span>
                      ) : (
                        <input
                          type="text"
                          value={row[col.key] || ""}
                          onChange={(e) =>
                            updateCell(index, col.key, e.target.value)
                          }
                          className="w-full bg-transparent border-none outline-none"
                        />
                      )}
                    </td>
                  ))}
                  <td>
                    <button
                      onClick={() => deleteRow(index)}
                      className="btn btn-outline p-1"
                      title="Delete Row"
                    >
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Action Buttons Row */}
        <div className="flex gap-3 mt-6 p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg justify-center flex-wrap">
          <button
            onClick={() => setCoDebtModal(true)}
            className="btn btn-outline"
          >
            <ArrowRight size={16} />
            C/O Debt
          </button>
          <button onClick={addDeliveryRow} className="btn btn-primary">
            <Plus size={16} />
            Add
          </button>
          <button
            onClick={() => setPaymentModal(true)}
            className="btn btn-secondary"
          >
            <DollarSign size={16} />
            Payment
          </button>
          <button
            onClick={() => setColumnModal(true)}
            className="btn btn-outline"
          >
            <Columns size={16} />
            Column
          </button>
        </div>

        {/* Totals */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4 p-4 bg-yellow-50 dark:bg-yellow-900/20 rounded-lg">
          <div>
            <strong>Total Supplied:</strong>{" "}
            {formatNumber(state.deliveryData.totals.totalSupplied)} L
          </div>
          <div>
            <strong>Total Payments:</strong> {currencySymbol}{" "}
            {formatNumber(state.deliveryData.totals.totalPayments)}
          </div>
          <div>
            <strong>Balance Due:</strong> {currencySymbol}{" "}
            {formatNumber(state.deliveryData.totals.balanceDue, 2)}
          </div>
        </div>
      </div>

      {/* Signatures (cross-device cloud-persisted) */}
      <div className="card">
        <h3 className="text-xl font-bold mb-4">Signatures</h3>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
          Signatures are saved to the cloud and available on every device you
          log in from.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <h4 className="text-sm font-semibold mb-2">Manager Signature</h4>
            {managerSignature && (
              <img
                src={managerSignature}
                alt="Manager signature"
                className="max-h-24 mb-2 border border-gray-200 dark:border-gray-700 rounded"
              />
            )}
            <SignatureCanvas onSave={handleManagerSig} />
          </div>
          <div>
            <h4 className="text-sm font-semibold mb-2">Director Signature</h4>
            {directorSignature && (
              <img
                src={directorSignature}
                alt="Director signature"
                className="max-h-24 mb-2 border border-gray-200 dark:border-gray-700 rounded"
              />
            )}
            <SignatureCanvas onSave={handleDirectorSig} />
          </div>
        </div>
      </div>

      {/* Saved Clients */}
      <div className="card">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-xl font-bold">Saved Clients</h3>
          <div className="flex gap-2">
            <button onClick={saveClient} className="btn btn-primary">
              <Save size={16} />
              Save Client
            </button>
            <button onClick={clearAllDelivery} className="btn btn-outline">
              <Trash2 size={16} />
              Clear All
            </button>
          </div>
        </div>
        <div className="history-panel">
          {Object.keys(state.clients).length === 0 && (
            <p className="text-sm text-gray-400 p-2">No saved clients yet.</p>
          )}
          {Object.keys(state.clients).map((key) => (
            <div key={key} className="history-item">
              <span>{key}</span>
              <div className="flex gap-2">
                <button onClick={() => loadClient(key)} className="text-xs">
                  Load
                </button>
                <button onClick={() => deleteClient(key)} className="text-xs">
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Export */}
      <div className="card">
        <ExportDropdown
          onExport={exportHandlers}
          title="Export Delivery Report"
        />
      </div>

      {/* ─── Modals (replace prompt/alert) ─── */}

      {/* Payment modal */}
      {paymentModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full p-6 space-y-4">
            <div className="flex justify-between items-center">
              <h3 className="text-lg font-bold">Record Payment</h3>
              <button
                onClick={() => setPaymentModal(false)}
                className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
              >
                <X size={20} />
              </button>
            </div>
            <div className="form-group">
              <label>Payment Amount ({currencySymbol})</label>
              <input
                type="number"
                value={paymentAmount}
                onChange={(e) => setPaymentAmount(e.target.value)}
                placeholder="0"
                autoFocus
                step="0.01"
                min="0"
              />
            </div>
            <div className="form-group">
              <label>Payment From (optional)</label>
              <input
                type="text"
                value={paymentName}
                onChange={(e) => setPaymentName(e.target.value)}
                placeholder="Customer name"
              />
            </div>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setPaymentModal(false)}
                className="btn btn-outline"
              >
                Cancel
              </button>
              <button onClick={submitPayment} className="btn btn-primary">
                <DollarSign size={16} />
                Save Payment
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Carried Over Debt modal */}
      {coDebtModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full p-6 space-y-4">
            <div className="flex justify-between items-center">
              <h3 className="text-lg font-bold">Add Carried Over Debt</h3>
              <button
                onClick={() => setCoDebtModal(false)}
                className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
              >
                <X size={20} />
              </button>
            </div>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              This adds a starting debt balance carried over from a previous
              period.
            </p>
            <div className="form-group">
              <label>Debt Amount ({currencySymbol})</label>
              <input
                type="number"
                value={coDebtAmount}
                onChange={(e) => setCoDebtAmount(e.target.value)}
                placeholder="0"
                autoFocus
                step="0.01"
                min="0"
              />
            </div>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setCoDebtModal(false)}
                className="btn btn-outline"
              >
                Cancel
              </button>
              <button onClick={submitCoDebt} className="btn btn-primary">
                <ArrowRight size={16} />
                Add Debt
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Column modal */}
      {columnModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full p-6 space-y-4">
            <div className="flex justify-between items-center">
              <h3 className="text-lg font-bold">Add Custom Column</h3>
              <button
                onClick={() => setColumnModal(false)}
                className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
              >
                <X size={20} />
              </button>
            </div>
            <div className="form-group">
              <label>Column Name</label>
              <input
                type="text"
                value={columnName}
                onChange={(e) => setColumnName(e.target.value)}
                placeholder="e.g. Driver, Invoice No, Notes"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Enter") submitColumn();
                }}
              />
            </div>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setColumnModal(false)}
                className="btn btn-outline"
              >
                Cancel
              </button>
              <button onClick={submitColumn} className="btn btn-primary">
                <Columns size={16} />
                Add Column
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
