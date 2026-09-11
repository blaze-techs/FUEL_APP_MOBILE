import { useState, useCallback, useEffect, useRef } from "react";
import {
  Save,
  Trash2,
  MessageCircle,
  Mail,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Plus,
  Bell,
} from "lucide-react";
import { useFuel } from "@/react-app/context/FuelContext";
import { useStations } from "@/react-app/context/StationContext";
import ExportDropdown from "@/react-app/components/ExportDropdown";
import {
  exportDebtPDF,
  exportDebtExcel,
  exportDebtTXT,
} from "@/react-app/utils/exportUtils";
import {
  formatAmountWithCommas,
  parseNumberFromFormatted,
  formatNumber,
} from "@/react-app/utils/formatUtils";
import {
  resolveCurrencySymbol,
  getDetectedCountryCode,
} from "@/react-app/lib/currency";
import { switchToTab } from "@/react-app/lib/mpesa-integration-service";
import {
  getScheduledReminders,
  addScheduledReminder,
  deleteScheduledReminder,
  toggleScheduledReminder,
  checkAndFireDueReminders,
  computeNextFireTime,
  formatReminderMessage,
  type ScheduledReminder,
  type ReminderMethod,
} from "@/react-app/lib/scheduled-reminder-service";

export default function DebtReminder() {
  const { state, dispatch } = useFuel();
  const currencySymbol = resolveCurrencySymbol(
    state.companyData?.currency,
    undefined,
  );
  const [debtCustomerName, setDebtCustomerName] = useState("");
  const [debtAmount, setDebtAmount] = useState("");
  const [buyGoodsNo, setBuyGoodsNo] = useState("");
  const [bankName, setBankName] = useState("");
  const [accountName, setAccountName] = useState("");
  const [accountNo, setAccountNo] = useState("");
  const [whatsappNo, setWhatsappNo] = useState("");
  const [managerName, setManagerName] = useState("");
  const [contactMethod, setContactMethod] = useState("WhatsApp");
  const [toast, setToast] = useState<string | null>(null);
  const [nameError, setNameError] = useState(false);
  const [deleteKey, setDeleteKey] = useState<string | null>(null);

  // ===== Scheduled Auto-Reminder state =====
  const { currentStation } = useStations();
  const stationId = currentStation?.id;
  const [scheduledReminders, setScheduledReminders] = useState<
    ScheduledReminder[]
  >([]);
  const [showScheduleForm, setShowScheduleForm] = useState(false);
  const [schedCustomerName, setSchedCustomerName] = useState("");
  const [schedAmount, setSchedAmount] = useState("");
  const [schedContact, setSchedContact] = useState("");
  const [schedMethod, setSchedMethod] = useState<ReminderMethod>("whatsapp");
  const [schedMessage, setSchedMessage] = useState(
    "Dear {{name}}, this is a reminder that {{currency}} {{amount}} for fuel supplied remains unpaid. Kindly settle the amount. Thank you.",
  );
  const [schedMinute, setSchedMinute] = useState<string>(""); // "" = every
  const [schedHour, setSchedHour] = useState<string>("9"); // default 9 AM
  const [schedDayOfMonth, setSchedDayOfMonth] = useState<string>(""); // "" = every
  const [schedMonth, setSchedMonth] = useState<string>(""); // "" = every
  const [schedRecurring, setSchedRecurring] = useState(true);
  const fireCheckRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  }, []);

  // Load scheduled reminders on mount + station change.
  const loadScheduledReminders = useCallback(async () => {
    try {
      const data = await getScheduledReminders(stationId);
      setScheduledReminders(data);
    } catch (err) {
      console.error("Failed to load scheduled reminders:", err);
    }
  }, [stationId]);

  useEffect(() => {
    loadScheduledReminders();
  }, [loadScheduledReminders]);

  // Fire a reminder via the appropriate channel. Only WhatsApp/Email can be
  // auto-opened from the browser; SMS shows a toast (requires a gateway).
  const fireReminder = useCallback(
    (reminder: ScheduledReminder, message: string) => {
      const cleanContact = reminder.contact.replace(/\D/g, "");
      if (reminder.method === "whatsapp" && cleanContact) {
        const url = `https://wa.me/${cleanContact}?text=${encodeURIComponent(message)}`;
        window.open(url, "_blank");
      } else if (reminder.method === "email") {
        const url = `mailto:${reminder.contact}?subject=${encodeURIComponent("Payment Reminder")}&body=${encodeURIComponent(message)}`;
        window.open(url, "_blank");
      }
      // SMS: no browser-native send; gateway integration needed.
      showToast(
        `Auto-reminder sent to ${reminder.customerName} via ${reminder.method}`,
      );
    },
    [showToast],
  );

  // Background interval: check every 30s for due reminders.
  useEffect(() => {
    const check = () => {
      checkAndFireDueReminders(stationId, fireReminder)
        .then((fired) => {
          if (fired.length > 0) {
            loadScheduledReminders();
          }
        })
        .catch((err) => console.error("Scheduled reminder check failed:", err));
    };
    // Check immediately on mount.
    check();
    fireCheckRef.current = setInterval(check, 30_000);
    return () => {
      if (fireCheckRef.current) clearInterval(fireCheckRef.current);
    };
  }, [stationId, fireReminder, loadScheduledReminders]);

  const handleAddScheduledReminder = async () => {
    if (!schedCustomerName.trim()) {
      showToast("Please enter a customer name");
      return;
    }
    if (!schedContact.trim()) {
      showToast("Please enter a contact (phone or email)");
      return;
    }
    const parseOrNull = (v: string): number | null => {
      const t = v.trim();
      if (t === "") return null;
      const n = parseInt(t, 10);
      return Number.isFinite(n) ? n : null;
    };
    try {
      await addScheduledReminder(
        {
          customerName: schedCustomerName.trim(),
          amount: parseNumberFromFormatted(schedAmount) || 0,
          currency: currencySymbol,
          contact: schedContact.trim(),
          method: schedMethod,
          messageFormat: schedMessage,
          minute: parseOrNull(schedMinute),
          hour: parseOrNull(schedHour),
          dayOfMonth: parseOrNull(schedDayOfMonth),
          month: parseOrNull(schedMonth),
          recurring: schedRecurring,
          enabled: true,
        },
        stationId,
      );
      showToast(`Scheduled reminder for ${schedCustomerName} created`);
      // Reset form.
      setSchedCustomerName("");
      setSchedAmount("");
      setSchedContact("");
      setSchedMessage(
        "Dear {{name}}, this is a reminder that {{currency}} {{amount}} for fuel supplied remains unpaid. Kindly settle the amount. Thank you.",
      );
      setSchedMinute("");
      setSchedHour("9");
      setSchedDayOfMonth("");
      setSchedMonth("");
      setSchedRecurring(true);
      setShowScheduleForm(false);
      loadScheduledReminders();
    } catch (err) {
      console.error("Failed to add scheduled reminder:", err);
      showToast("Failed to create scheduled reminder");
    }
  };

  const handleDeleteScheduled = async (id: string) => {
    try {
      await deleteScheduledReminder(id, stationId);
      loadScheduledReminders();
      showToast("Scheduled reminder deleted");
    } catch (err) {
      console.error("Failed to delete scheduled reminder:", err);
    }
  };

  const handleToggleScheduled = async (id: string) => {
    try {
      await toggleScheduledReminder(id, stationId);
      loadScheduledReminders();
    } catch (err) {
      console.error("Failed to toggle scheduled reminder:", err);
    }
  };

  const formatSchedule = (r: ScheduledReminder): string => {
    const parts: string[] = [];
    parts.push(
      r.minute !== null
        ? `:${String(r.minute).padStart(2, "0")}`
        : "every minute",
    );
    parts.push(
      r.hour !== null ? `${String(r.hour).padStart(2, "0")}h` : "every hour",
    );
    parts.push(r.dayOfMonth !== null ? `day ${r.dayOfMonth}` : "every day");
    parts.push(r.month !== null ? `month ${r.month}` : "every month");
    return parts.join(", ");
  };

  const handleAmountChange = (value: string) => {
    const formatted = formatAmountWithCommas(value);
    setDebtAmount(formatted);
  };

  const clearDebtForm = () => {
    setDebtCustomerName("");
    setDebtAmount("");
    setBuyGoodsNo("");
    setBankName("");
    setAccountName("");
    setAccountNo("");
    setWhatsappNo("");
    setManagerName("");
  };

  const getDebtData = () => {
    return {
      name: debtCustomerName || "[Customer Name]",
      amount: formatNumber(parseNumberFromFormatted(debtAmount) || 0),
      till: buyGoodsNo || "[Till]",
      bank: bankName || "[Bank]",
      acName: accountName || "[A/C Name]",
      acNo: accountNo || "[A/C No.]",
      contact: whatsappNo || "[Contact]",
      method: contactMethod,
      manager: managerName || "[Manager]",
    };
  };

  const saveDebtReminder = () => {
    const name = debtCustomerName.trim();
    if (!name) {
      setNameError(true);
      showToast("Please enter a customer name");
      return;
    }
    setNameError(false);

    const data = {
      name: debtCustomerName,
      amount: parseNumberFromFormatted(debtAmount) || 0,
      till: buyGoodsNo,
      bank: bankName,
      acName: accountName,
      acNo: accountNo,
      contact: whatsappNo,
      method: contactMethod,
      manager: managerName,
    };

    const date = new Date().toISOString().split("T")[0];
    const key = `${date}_${name.replace(/\s+/g, "_")}`;

    dispatch({
      type: "SET_DEBT_HISTORY",
      payload: { ...state.debtHistory, [key]: data },
    });

    showToast(`Debt reminder for ${name} saved`);
  };

  const loadDebt = (key: string) => {
    const item = state.debtHistory[key];
    if (!item) return;

    setDebtCustomerName(item.name || "");
    setDebtAmount(
      typeof item.amount === "number"
        ? formatNumber(item.amount)
        : String(item.amount || ""),
    );
    setBuyGoodsNo(item.till || "");
    setBankName(item.bank || "");
    setAccountName(item.acName || "");
    setAccountNo(item.acNo || "");
    setWhatsappNo(item.contact || "");
    setManagerName(item.manager || "");
    setContactMethod(item.method || "WhatsApp");
  };

  const deleteDebt = (key: string) => {
    const updatedHistory = { ...state.debtHistory };
    delete updatedHistory[key];
    dispatch({ type: "SET_DEBT_HISTORY", payload: updatedHistory });
    setDeleteKey(null);
    showToast("Reminder deleted");
  };

  const sendWhatsApp = () => {
    const data = getDebtData();
    const msg = `Dear ${data.name},%0A%0AThis is a gentle reminder that ${currencySymbol} ${data.amount} for fuel supplied remains unpaid.%0A%0AKindly settle the amount via Till:%0ABuy Goods: ${data.till}%0A%0AFor bank transfer:%0ABank: ${data.bank}%0AA/C Name: ${data.acName}%0AA/C No.: ${data.acNo}%0A%0AAfter payment, share the confirmation with us via ${data.method}: ${data.contact}%0A%0AThank you.%0A%0ABest regards,%0A${data.manager}%0AManager%0A${state.companyData.name}%0A%0AP.O. Box: ${state.companyData.poBox || "N/A"}%0ACONTACTS: ${state.companyData.contacts || "N/A"}%0AEMAIL: ${state.companyData.email || "N/A"}`;
    const url = `https://wa.me/${data.contact.replace(/\D/g, "")}?text=${msg}`;
    window.open(url, "_blank");
  };

  const sendEmail = () => {
    const data = getDebtData();
    const subject = `Fuel Debt Reminder - ${data.amount}`;
    const body = `Dear ${data.name},\n\nThis is a gentle reminder that ${currencySymbol} ${data.amount} for fuel supplied remains unpaid.\n\nKindly settle the amount via Till:\nBuy Goods: ${data.till}\n\nFor bank transfer:\nBank: ${data.bank}\nA/C Name: ${data.acName}\nA/C No.: ${data.acNo}\n\nAfter payment, share the confirmation with us via ${data.method}: ${data.contact}\n\nThank you.\n\nBest regards,\n${data.manager}\nManager\n${state.companyData.name}\n\nP.O. Box: ${state.companyData.poBox || "N/A"}\nCONTACTS: ${state.companyData.contacts || "N/A"}\nEMAIL: ${state.companyData.email || "N/A"}`;
    window.location.href = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  };

  const exportHandlers = {
    pdf: async () =>
      await exportDebtPDF({
        ...state,
        debtData: getDebtData(),
      }),
    excel: () =>
      exportDebtExcel({
        ...state,
        debtData: getDebtData(),
      }),
    txt: () =>
      exportDebtTXT({
        ...state,
        debtData: getDebtData(),
      }),
    whatsapp: () => {
      const data = getDebtData();
      const msg = `*${state.companyData.name}*\n\n*Fuel Debt Payment Reminder*\n\nDear ${data.name},\n\nThis is a gentle reminder that ${currencySymbol} ${data.amount} for fuel supplied remains unpaid.\n\nKindly settle the amount via Till:\nBuy Goods: ${data.till}\n\nFor bank transfer:\nBank: ${data.bank}\nA/C Name: ${data.acName}\nA/C No.: ${data.acNo}\n\nAfter payment, share the confirmation with us via ${data.method}: ${data.contact}\n\nThank you.\n\nBest regards,\n${data.manager}\nManager\n${state.companyData.name}\n\n*P.O. Box:* ${state.companyData.poBox || "N/A"}\n*CONTACTS:* ${state.companyData.contacts || "N/A"}\n*EMAIL:* ${state.companyData.email || "N/A"}`;
      const url = `https://wa.me/?text=${encodeURIComponent(msg)}`;
      window.open(url, "_blank");
    },
    email: () => {
      const data = getDebtData();
      const subject = `Fuel Debt Payment Reminder - ${data.amount}`;
      const body = `${state.companyData.name}\n\nFuel Debt Payment Reminder\n\nDear ${data.name},\n\nThis is a gentle reminder that ${currencySymbol} ${data.amount} for fuel supplied remains unpaid.\n\nKindly settle the amount via Till:\nBuy Goods: ${data.till}\n\nFor bank transfer:\nBank: ${data.bank}\nA/C Name: ${data.acName}\nA/C No.: ${data.acNo}\n\nAfter payment, share the confirmation with us via ${data.method}: ${data.contact}\n\nThank you.\n\nBest regards,\n${data.manager}\nManager\n${state.companyData.name}\n\nP.O. Box: ${state.companyData.poBox || "N/A"}\nCONTACTS: ${state.companyData.contacts || "N/A"}\nEMAIL: ${state.companyData.email || "N/A"}`;
      window.location.href = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    },
  };

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="card">
        <div className="flex justify-between items-center mb-6 pb-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-2xl font-bold text-blue-900 dark:text-blue-200">
            Fuel Debt Payment Reminder
          </h2>
          <div className="flex gap-2">
            <button onClick={saveDebtReminder} className="btn btn-primary">
              <Save size={16} />
              Save
            </button>
            <button onClick={clearDebtForm} className="btn btn-outline">
              <Trash2 size={16} />
              Clear
            </button>
          </div>
        </div>

        {/* Form Fields */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <div className="form-group">
            <label>Customer Name</label>
            <input
              type="text"
              value={debtCustomerName}
              onChange={(e) => {
                setDebtCustomerName(e.target.value);
                if (nameError) setNameError(false);
              }}
              placeholder="Customer name"
              className={nameError ? "border-red-500" : ""}
            />
            {nameError && (
              <p className="text-xs text-red-500 mt-1">
                Customer name is required
              </p>
            )}
          </div>
          <div className="form-group">
            <label>{`Amount (${currencySymbol})`}</label>
            <input
              type="text"
              value={debtAmount}
              onChange={(e) => handleAmountChange(e.target.value)}
              placeholder="0"
            />
          </div>
          <div className="form-group">
            <label>Buy Goods Number</label>
            <input
              type="text"
              value={buyGoodsNo}
              onChange={(e) => setBuyGoodsNo(e.target.value)}
              placeholder="e.g. 123456"
            />
          </div>
          <div className="form-group">
            <label>Bank Name</label>
            <input
              type="text"
              value={bankName}
              onChange={(e) => setBankName(e.target.value)}
              placeholder="e.g. Equity Bank"
            />
          </div>
          <div className="form-group">
            <label>A/C Name</label>
            <input
              type="text"
              value={accountName}
              onChange={(e) => setAccountName(e.target.value)}
              placeholder="Account holder name"
            />
          </div>
          <div className="form-group">
            <label>A/C No.</label>
            <input
              type="text"
              value={accountNo}
              onChange={(e) => setAccountNo(e.target.value)}
              placeholder="Account number"
            />
          </div>
          <div className="form-group">
            <label>WhatsApp Number</label>
            <input
              type="text"
              value={whatsappNo}
              onChange={(e) => setWhatsappNo(e.target.value)}
              placeholder="+1 555 000 0000"
            />
          </div>
          <div className="form-group">
            <label>Manager Name</label>
            <input
              type="text"
              value={managerName}
              onChange={(e) => setManagerName(e.target.value)}
              placeholder="Manager name"
            />
          </div>
          <div className="form-group">
            <label>Contact Method</label>
            <select
              value={contactMethod}
              onChange={(e) => setContactMethod(e.target.value)}
            >
              <option value="WhatsApp">WhatsApp</option>
              <option value="Email">Email</option>
            </select>
          </div>
        </div>
      </div>

      {/* Client History */}
      <div className="card">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-xl font-bold">Client History</h3>
          <div className="flex gap-2">
            <button
              onClick={() => switchToTab("credit")}
              className="text-xs btn btn-secondary"
            >
              Credit Accounts
            </button>
            <button
              onClick={() => switchToTab("invoice")}
              className="text-xs btn btn-secondary"
            >
              New Invoice
            </button>
            <button
              onClick={() => switchToTab("pos")}
              className="text-xs btn btn-secondary"
            >
              Point of Sale
            </button>
          </div>
        </div>
        <div className="history-panel">
          {Object.keys(state.debtHistory).length === 0 ? (
            <div className="text-center py-8 text-gray-400">
              <Bell className="w-12 h-12 mx-auto mb-2 opacity-50" />
              <p>No debt reminders yet</p>
              <p className="text-xs mt-1">
                Fill the form above to create your first debt payment reminder
              </p>
            </div>
          ) : (
            Object.keys(state.debtHistory)
              .sort(
                (a, b) =>
                  new Date(b.split("_")[0]).getTime() -
                  new Date(a.split("_")[0]).getTime(),
              )
              .map((key) => {
                const item = state.debtHistory[key];
                return (
                  <div key={key} className="history-item">
                    <span>
                      {item.name} - {currencySymbol}{" "}
                      {formatNumber(
                        typeof item.amount === "number"
                          ? item.amount
                          : parseNumberFromFormatted(String(item.amount)) || 0,
                      )}
                    </span>
                    <div className="flex gap-2">
                      <button onClick={() => loadDebt(key)} className="text-xs">
                        Load
                      </button>
                      <button
                        onClick={() => setDeleteKey(key)}
                        className="text-xs text-red-500"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                );
              })
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="card">
        <div className="flex gap-4 flex-wrap">
          <ExportDropdown onExport={exportHandlers} title="Export Reminder" />
          <button onClick={sendWhatsApp} className="btn btn-secondary">
            <MessageCircle size={16} />
            WhatsApp
          </button>
          <button onClick={sendEmail} className="btn btn-outline">
            <Mail size={16} />
            Email
          </button>
        </div>
      </div>

      {/* Delete confirmation modal */}
      {deleteKey && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-xl p-6 max-w-sm w-full shadow-2xl">
            <div className="flex items-center gap-2 mb-4">
              <AlertTriangle className="text-red-500" size={20} />
              <h3 className="text-lg font-semibold dark:text-white">
                Delete Reminder?
              </h3>
            </div>
            <p className="text-sm text-gray-500 mb-4">
              This will permanently delete this debt reminder. This cannot be
              undone.
            </p>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setDeleteKey(null)}
                className="px-4 py-2 bg-gray-200 dark:bg-gray-700 rounded-lg text-sm dark:text-white"
              >
                Cancel
              </button>
              <button
                onClick={() => deleteDebt(deleteKey)}
                className="px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-medium"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===== Scheduled Auto-Reminders ===== */}
      <div className="card">
        <div className="flex justify-between items-center mb-4 pb-3 border-b border-gray-200 dark:border-gray-700">
          <h3 className="text-lg font-bold text-blue-900 dark:text-blue-200 flex items-center gap-2">
            <Bell size={18} />
            Scheduled Auto-Reminders
          </h3>
          <button
            onClick={() => setShowScheduleForm(!showScheduleForm)}
            className="btn btn-primary text-sm"
          >
            <Plus size={14} />
            Schedule Reminder
          </button>
        </div>

        {showScheduleForm && (
          <div className="mb-4 p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800 space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-gray-500">Customer Name *</label>
                <input
                  type="text"
                  value={schedCustomerName}
                  onChange={(e) => setSchedCustomerName(e.target.value)}
                  className="w-full px-3 py-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg text-sm dark:text-white"
                  placeholder="e.g. John Mwangi"
                />
              </div>
              <div>
                <label className="text-xs text-gray-500">
                  Amount ({currencySymbol})
                </label>
                <input
                  type="text"
                  value={schedAmount}
                  onChange={(e) => setSchedAmount(e.target.value)}
                  className="w-full px-3 py-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg text-sm dark:text-white"
                  placeholder="e.g. 5,000"
                />
              </div>
              <div>
                <label className="text-xs text-gray-500">
                  Contact (phone/email) *
                </label>
                <input
                  type="text"
                  value={schedContact}
                  onChange={(e) => setSchedContact(e.target.value)}
                  className="w-full px-3 py-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg text-sm dark:text-white"
                  placeholder={`e.g. ${getDetectedCountryCode() === "US" ? "15551234567" : getDetectedCountryCode() === "KE" ? "254712345678" : "1000000000"} or john@email.com`}
                />
              </div>
              <div>
                <label className="text-xs text-gray-500">Method</label>
                <select
                  value={schedMethod}
                  onChange={(e) =>
                    setSchedMethod(e.target.value as ReminderMethod)
                  }
                  className="w-full px-3 py-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg text-sm dark:text-white"
                >
                  <option value="whatsapp">WhatsApp</option>
                  <option value="email">Email</option>
                  <option value="sms">SMS (requires gateway)</option>
                </select>
              </div>
            </div>

            {/* Schedule fields */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              <div>
                <label className="text-xs text-gray-500">Minute</label>
                <input
                  type="text"
                  value={schedMinute}
                  onChange={(e) => setSchedMinute(e.target.value)}
                  className="w-full px-2 py-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg text-sm dark:text-white"
                  placeholder="every"
                />
              </div>
              <div>
                <label className="text-xs text-gray-500">Hour</label>
                <input
                  type="text"
                  value={schedHour}
                  onChange={(e) => setSchedHour(e.target.value)}
                  className="w-full px-2 py-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg text-sm dark:text-white"
                  placeholder="every"
                />
              </div>
              <div>
                <label className="text-xs text-gray-500">Day of Month</label>
                <input
                  type="text"
                  value={schedDayOfMonth}
                  onChange={(e) => setSchedDayOfMonth(e.target.value)}
                  className="w-full px-2 py-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg text-sm dark:text-white"
                  placeholder="every"
                />
              </div>
              <div>
                <label className="text-xs text-gray-500">Month (1-12)</label>
                <input
                  type="text"
                  value={schedMonth}
                  onChange={(e) => setSchedMonth(e.target.value)}
                  className="w-full px-2 py-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg text-sm dark:text-white"
                  placeholder="every"
                />
              </div>
              <div className="flex items-end">
                <label className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={schedRecurring}
                    onChange={(e) => setSchedRecurring(e.target.checked)}
                    className="rounded"
                  />
                  Recurring
                </label>
              </div>
            </div>
            <p className="text-[10px] text-gray-400">
              Leave a field empty for "every". Example: Hour=9, Minute=0, Day=1
              = every 1st of the month at 9:00 AM. Hour=9 only = every day at
              9:00 AM (every hour if Hour empty too).
            </p>

            <div>
              <label className="text-xs text-gray-500">Message Format</label>
              <textarea
                value={schedMessage}
                onChange={(e) => setSchedMessage(e.target.value)}
                rows={3}
                className="w-full px-3 py-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg text-sm dark:text-white"
                placeholder="Use {{name}}, {{amount}}, {{currency}}"
              />
            </div>

            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setShowScheduleForm(false)}
                className="px-4 py-2 bg-gray-200 dark:bg-gray-700 rounded-lg text-sm dark:text-white"
              >
                Cancel
              </button>
              <button
                onClick={handleAddScheduledReminder}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium"
              >
                Create Reminder
              </button>
            </div>
          </div>
        )}

        {/* List of scheduled reminders */}
        {scheduledReminders.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-6">
            No scheduled auto-reminders yet. Click "Schedule Reminder" to
            automate debt collection notifications.
          </p>
        ) : (
          <div className="space-y-2">
            {scheduledReminders.map((r) => (
              <div
                key={r.id}
                className={`flex items-center justify-between p-3 rounded-lg border ${r.enabled ? "bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800" : "bg-gray-50 dark:bg-gray-800 border-gray-200 dark:border-gray-700"}`}
              >
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-sm dark:text-white">
                      {r.customerName}
                    </span>
                    <span className="text-xs text-gray-400">
                      {currencySymbol} {formatNumber(r.amount)}
                    </span>
                    <span
                      className={`text-[10px] px-2 py-0.5 rounded-full ${r.enabled ? "bg-green-500/10 text-green-600" : "bg-gray-500/10 text-gray-500"}`}
                    >
                      {r.enabled ? "Active" : "Paused"}
                    </span>
                    {!r.recurring && (
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-600">
                        One-time
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 mt-1 text-[11px] text-gray-400">
                    <span className="flex items-center gap-1">
                      <Clock size={11} />
                      {formatSchedule(r)}
                    </span>
                    <span>
                      {r.method === "whatsapp"
                        ? "📱 WhatsApp"
                        : r.method === "email"
                          ? "✉️ Email"
                          : "💬 SMS"}
                    </span>
                    <span>→ {r.contact}</span>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => handleToggleScheduled(r.id)}
                    className="p-1.5 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg"
                    title={r.enabled ? "Pause" : "Enable"}
                  >
                    <Bell
                      size={14}
                      className={r.enabled ? "text-green-600" : "text-gray-400"}
                    />
                  </button>
                  <button
                    onClick={() => handleDeleteScheduled(r.id)}
                    className="p-1.5 hover:bg-red-100 dark:hover:bg-red-900/30 rounded-lg"
                    title="Delete"
                  >
                    <Trash2 size={14} className="text-red-500" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Toast notification */}
      {toast && (
        <div className="fixed bottom-6 right-6 bg-gray-900 dark:bg-gray-700 text-white px-4 py-3 rounded-xl shadow-2xl text-sm font-medium z-50 flex items-center gap-2">
          <CheckCircle2 size={16} className="text-green-400" />
          {toast}
        </div>
      )}
    </div>
  );
}
