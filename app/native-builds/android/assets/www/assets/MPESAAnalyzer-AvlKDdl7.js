import {
  c as Ae,
  J as Pe,
  e as Me,
  i as U,
  Z as Ye,
  w as Ge,
  R as J,
  a5 as X,
  z as Ce,
  ah as He,
  a4 as u,
  S as Ze,
  n as qe,
  X as Ve,
  v as Je,
  ai as Xe,
} from "./index-DGiOi-Vv.js";
import { j as e } from "./trpc-DPYLJugK.js";
import { b as m } from "./vendor-ByIt1aj4.js";
import { C as Q } from "./calculator-DxYfe25i.js";
import { B as Qe } from "./ban-D4vMNYUe.js";
/**
 * @license lucide-react v0.510.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */ const et = [
    ["path", { d: "m8 2 1.88 1.88", key: "fmnt4t" }],
    ["path", { d: "M14.12 3.88 16 2", key: "qol33r" }],
    ["path", { d: "M9 7.13v-1a3.003 3.003 0 1 1 6 0v1", key: "d7y7pr" }],
    [
      "path",
      {
        d: "M12 20c-3.3 0-6-2.7-6-6v-3a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v3c0 3.3-2.7 6-6 6",
        key: "xs1cw7",
      },
    ],
    ["path", { d: "M12 20v-9", key: "1qisl0" }],
    ["path", { d: "M6.53 9C4.6 8.8 3 7.1 3 5", key: "32zzws" }],
    ["path", { d: "M6 13H2", key: "82j7cp" }],
    ["path", { d: "M3 21c0-2.1 1.7-3.9 3.8-4", key: "4p0ekp" }],
    ["path", { d: "M20.97 5c0 2.1-1.6 3.8-3.5 4", key: "18gb23" }],
    ["path", { d: "M22 13h-4", key: "1jl80f" }],
    ["path", { d: "M17.2 17c2.1.1 3.8 1.9 3.8 4", key: "k3fwyw" }],
  ],
  tt = Ae("bug", et);
/**
 * @license lucide-react v0.510.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */ const at = [
    ["path", { d: "M11 14h10", key: "1w8e9d" }],
    ["path", { d: "M16 4h2a2 2 0 0 1 2 2v1.344", key: "1e62lh" }],
    ["path", { d: "m17 18 4-4-4-4", key: "z2g111" }],
    [
      "path",
      {
        d: "M8 4H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 1.793-1.113",
        key: "bjbb7m",
      },
    ],
    [
      "rect",
      { x: "8", y: "2", width: "8", height: "4", rx: "1", key: "ublpy" },
    ],
  ],
  Se = Ae("clipboard-paste", at),
  rt = [
    "Loan Disbursement",
    "Merchant to ",
    "Overdraft Repayment",
    "Merchant Payment Charge",
    "Pay merchant Charge",
    "Funds Transfer",
    "Merchant to Merchant",
    "Buy Goods",
    "Withdraw to Bank",
    "Withdraw at Agent",
    "Sell Airtime",
    "Pay Bill",
    "Pay Merchant Charge",
    "Merchant Pay Utility",
  ];
function it() {
  const [F, Re] = m.useState("pdf"),
    [C, ee] = m.useState([]),
    [N, te] = m.useState(""),
    [O, Te] = m.useState(!1),
    [S, B] = m.useState([]),
    [M, E] = m.useState([]),
    [l, $] = m.useState(null),
    [w, R] = m.useState(!1),
    [ae, K] = m.useState([]),
    [W, Ie] = m.useState("auto"),
    [re, se] = m.useState(""),
    [A, Fe] = m.useState(""),
    [ne, Y] = m.useState(""),
    [G, Ee] = m.useState(!1),
    [H, D] = m.useState(""),
    [T, le] = m.useState(""),
    [z, de] = m.useState(""),
    [L, oe] = m.useState(""),
    [ie, ce] = m.useState(null),
    [xe, me] = m.useState(0),
    [Z, $e] = m.useState(!1),
    he = m.useRef(null),
    b = m.useCallback(t => {
      K(a => [...a, t]);
    }, []),
    De = t => {
      const a = [],
        s = [];
      for (let d = 0; d < t.length; d++) {
        const n = t[d].trim();
        if (!n || !n.includes("Completed")) continue;
        const o = [];
        for (const p of n.matchAll(
          /([0-9]{1,3}(?:,[0-9]{3})+\.[0-9]{2}|[0-9]+\.[0-9]{2})/g
        ))
          o.push(parseFloat(p[1].replace(/,/g, "")));
        if (o.length < 3) continue;
        const h = o[o.length - 3],
          f = o[o.length - 2],
          y = o[o.length - 1],
          k = n.match(/\b([A-Z0-9]{10})\b/),
          j = k ? k[1] : "",
          v = n.match(/(\d{4}-\d{2}-\d{2})/),
          g = v ? v[1] : "";
        let i = "unknown";
        n.includes("Merchant Payment from")
          ? (i = "merchant_payment")
          : n.includes("Loan Disbursement")
            ? (i = "loan_disbursement")
            : n.includes("Biashara Overdraft")
              ? (i = "overdraft")
              : n.includes("Pay merchant Charge") ||
                  n.includes("Pay Merchant Charge")
                ? (i = "merchant_charge")
                : n.includes("Merchant Payment Charge")
                  ? (i = "payment_charge")
                  : n.includes("Merchant to Utility")
                    ? (i = "utility_payment")
                    : n.includes("Merchant Pay Utility")
                      ? (i = "utility_pay")
                      : n.includes("Merchant to Merchant")
                        ? (i = "merchant_transfer")
                        : n.includes("Funds Transfer") &&
                          (i = "funds_transfer");
        const r = i === "loan_disbursement" || i === "overdraft",
          c = i === "merchant_charge" || i === "payment_charge",
          x = i === "utility_payment" || i === "utility_pay",
          P = i === "merchant_transfer" || i === "funds_transfer";
        if (r && h > 0) {
          s.push({
            receipt: j,
            date: g,
            type: i,
            amount: h,
            reason: "Loan/Overdraft - not operating revenue",
          });
          continue;
        }
        if (h <= 0) {
          (c || x || P) &&
            f > 0 &&
            s.push({
              receipt: j,
              date: g,
              type: i,
              amount: f,
              reason: c
                ? "Merchant charge"
                : x
                  ? "Utility payment"
                  : "Transfer",
            });
          continue;
        }
        if (rt.some(p => n.includes(p)) || !n.includes("Merchant Payment from"))
          continue;
        const V = [];
        for (let p = 1; p <= 3; p++)
          d + p < t.length && V.push(t[d + p].trim());
        const _ = V.join(" ");
        let I = "";
        const fe = n.includes("Online") || _.includes("Online"),
          ye = _.match(/((?:254)?\d{2,4}\*+\d{3})/),
          je = ye ? ye[1] : "",
          Ne = _.match(
            /(?:\d{3,4}\*+\d{3}|254\d{0,3}\*+\d{3})\s*-\s*(.+?)(?:\s+Merchant|\s+Payment|$)/i
          );
        if (Ne) {
          let p = Ne[1].trim();
          p = p
            .replace(/\s+(ENERGY|SWAFIA|Customer|Merchant|Payment)\s*$/gi, "")
            .trim();
          for (const We of V.slice(1)) {
            const we = We.match(
              /^([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+){0,2})\s+Payment\s+ENERGY/
            );
            if (we) {
              for (const ve of we[1].split(/\s+/))
                p.toLowerCase().includes(ve.toLowerCase()) || (p += ` ${ve}`);
              break;
            }
          }
          je && p ? (I = `Payment from ${je} - ${p}`) : p && (I = p);
        }
        I || (I = fe ? "Merchant Payment (Online)" : "Merchant Payment");
        const ke =
            n.match(/(\d{2}:\d{2}:\d{2})/) || _.match(/(\d{2}:\d{2}:\d{2})/),
          Ke = ke ? ke[1] : "";
        a.push({
          details: I,
          paidIn: h,
          balance: y,
          receipt: j,
          date: g,
          time: Ke,
          isOnline: fe,
        });
      }
      return { inflows: a, excluded: s };
    },
    ze = async t => {
      try {
        const a = await t.arrayBuffer();
        let s;
        try {
          s = await Xe(() => import("./pdf-Vuf_RiOE.js"), []);
        } catch {
          return {
            lines: [],
            error:
              "pdfjs-dist library not available. Please use Manual Text Paste mode instead.",
          };
        }
        const d = s.version || "5.6.205";
        s.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${d}/build/pdf.worker.min.mjs`;
        const n = await s.getDocument({ data: a }).promise,
          o = [];
        for (let h = 1; h <= n.numPages; h++) {
          const k = (await (await n.getPage(h)).getTextContent()).items,
            j = new Map();
          for (const g of k) {
            if (!g.str || !g.str.trim()) continue;
            const i = Math.round(g.transform[5] * 10) / 10,
              r = g.transform[4];
            let c = !1;
            for (const [x, P] of j)
              if (Math.abs(x - i) < 3) {
                (P.push({ x: r, text: g.str }), (c = !0));
                break;
              }
            c || j.set(i, [{ x: r, text: g.str }]);
          }
          const v = Array.from(j.entries())
            .sort((g, i) => i[0] - g[0])
            .map(
              ([, g]) => (
                g.sort((i, r) => i.x - r.x),
                g
                  .map(i => i.text)
                  .join(" ")
                  .trim()
              )
            )
            .filter(Boolean);
          o.push(...v);
        }
        return { lines: o };
      } catch (a) {
        return { lines: [], error: a.message || "Failed to extract PDF text" };
      }
    },
    Le = async t => {
      var d, n, o, h, f;
      const a = [];
      for (let y = 0; y < t.length; y += 2e4) {
        const j = `Extract ONLY "Merchant Payment from" inflow transactions from this M-PESA statement. For each, return: {"details":"Phone - Customer Name","paidIn":number,"balance":number,"receipt":"10-char code","date":"YYYY-MM-DD","time":"HH:MM:SS"}. Return JSON array only. Exclude loans, charges, transfers.

${t.slice(y, y + 2e4)}`;
        try {
          const v = await fetch(
            "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=AIzaSy_REPLACE_WITH_GOOGLE_API_KEY",
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                contents: [{ role: "user", parts: [{ text: j }] }],
                generationConfig: {
                  temperature: 0.05,
                  responseMimeType: "application/json",
                },
              }),
            }
          );
          if (!v.ok) continue;
          const i =
            ((f =
              (h =
                (o =
                  (n =
                    (d = (await v.json()).candidates) == null
                      ? void 0
                      : d[0]) == null
                    ? void 0
                    : n.content) == null
                  ? void 0
                  : o.parts) == null
                ? void 0
                : h[0]) == null
              ? void 0
              : f.text) || "";
          let r = [];
          try {
            r = JSON.parse(i);
          } catch {
            const x = i.match(/\[[\s\S]*\]/);
            x && (r = JSON.parse(x[0]));
          }
          const c = (Array.isArray(r) ? r : [r])
            .filter(Boolean)
            .map(x => ({
              details: String(x.details || "Payment").trim(),
              paidIn: parseFloat(x.paidIn || 0),
              balance: parseFloat(x.balance || 0),
              receipt: String(x.receipt || ""),
              date: String(x.date || ""),
              time: String(x.time || ""),
              isOnline: String(x.details || "")
                .toLowerCase()
                .includes("online"),
            }))
            .filter(x => x.paidIn > 0 && x.paidIn < 99999999);
          (a.push(...c),
            b(
              `AI processed ${Math.min(y + 2e4, t.length).toLocaleString()} / ${t.length.toLocaleString()} chars`
            ));
        } catch {}
      }
      return a;
    },
    ge = (t, a) => {
      const s = t.reduce((r, c) => r + c.paidIn, 0),
        d = new Map();
      for (const r of t) {
        const c =
            r.details.replace(/Payment from\s+\S+\s*-\s*/, "").trim() ||
            r.details,
          x = d.get(c) || { amount: 0, count: 0 };
        ((x.amount += r.paidIn), x.count++, d.set(c, x));
      }
      let n = { name: "", amount: 0, count: 0 };
      for (const [r, c] of d) c.amount > n.amount && (n = { name: r, ...c });
      const o = t
          .map(r => r.date)
          .filter(Boolean)
          .sort(),
        h = [...t].sort((r, c) => {
          const x = `${r.date || "0000-00-00"}T${r.time || "00:00:00"}`,
            P = `${c.date || "0000-00-00"}T${c.time || "00:00:00"}`;
          return x.localeCompare(P);
        });
      let f = 0;
      const y = [];
      for (let r = 0; r < h.length; r++) {
        const c = h[r];
        if (r === 0) continue;
        const x = h[r - 1];
        if (x.balance > 0 && c.balance > 0) {
          const P = c.balance - x.balance;
          (P > 0 && (f += P),
            y.push({
              receipt: c.receipt,
              prevBalance: x.balance,
              currBalance: c.balance,
              delta: Math.round(P * 100) / 100,
            }));
        }
      }
      const k = s,
        j = Math.max(f - k, 0),
        v = k > 0 ? Math.abs(f - k) / k : 0,
        g = j > 0.01,
        i =
          y.length >= 3
            ? g
              ? "Medium — unrecorded inflows detected via balance deltas"
              : "High — balance matches recorded inflows"
            : y.length > 0
              ? "Low — insufficient balance data for analysis"
              : "N/A — no balance data available";
      return {
        totalInflows: t.length,
        totalAmount: s,
        uniqueCustomers: d.size,
        onlinePayments: t.filter(r => r.isOnline).length,
        averagePayment: t.length > 0 ? s / t.length : 0,
        topCustomer: n,
        dateRange: { from: o[0] || "", to: o[o.length - 1] || "" },
        cleanRevenue: {
          genuineRevenue: s,
          excludedLoans: a
            .filter(r => r.reason.includes("Loan"))
            .reduce((r, c) => r + c.amount, 0),
          excludedCharges: a
            .filter(r => r.reason.includes("charge"))
            .reduce((r, c) => r + c.amount, 0),
          excludedTransfers: a
            .filter(
              r => r.reason.includes("Utility") || r.reason.includes("Transfer")
            )
            .reduce((r, c) => r + c.amount, 0),
          totalExcluded: a.reduce((r, c) => r + c.amount, 0),
          excludedRecords: a,
        },
        balanceAnalysis: {
          recordedNet: k,
          trueInflow: Math.round(f * 100) / 100,
          unrecordedInflow: Math.round(j * 100) / 100,
          discrepancy: Math.round(v * 1e4) / 100,
          hasUnrecorded: g,
          confidence: i,
        },
      };
    },
    _e = async () => {
      if (C.length) {
        (R(!0), K([]), E([]), $(null), Y(""), D(""), B([]));
        try {
          b(`Reading ${C.length} PDF(s)...`);
          let t = [];
          for (const a of C) {
            b(`Extracting text from "${a.name}"...`);
            const { lines: s, error: d } = await ze(a);
            if (d) {
              (b(`ERROR: ${d}`),
                D(`PDF Extraction Error: ${d}

Try using "Manual Text Paste" mode instead. Copy text from your PDF viewer and paste it.`),
                R(!1));
              return;
            }
            (b(`Extracted ${s.length} lines from "${a.name}"`), t.push(...s));
          }
          (B(t),
            W === "ai"
              ? await be(
                  t.join(`
`)
                )
              : await ue(t));
        } catch (t) {
          b(`Fatal error: ${t.message}`);
        } finally {
          R(!1);
        }
      }
    },
    pe = async () => {
      if (N.trim()) {
        (R(!0), K([]), E([]), $(null), Y(""), D(""));
        try {
          const t = N.split(
            `
`
          )
            .map(a => a.trim())
            .filter(Boolean);
          (b(`Pasted text: ${t.length} lines`),
            B(t),
            W === "ai" ? await be(N) : await ue(t));
        } catch (t) {
          b(`Error: ${t.message}`);
        } finally {
          R(!1);
        }
      }
    },
    ue = async t => {
      (se("Pattern (Regex)"), b("Running pattern extraction..."));
      let a = 0;
      for (const o of t) {
        if (!o.includes("Completed")) continue;
        const h = [];
        for (const f of o.matchAll(
          /([0-9]{1,3}(?:,[0-9]{3})+\.[0-9]{2}|[0-9]+\.[0-9]{2})/g
        ))
          h.push(parseFloat(f[1].replace(/,/g, "")));
        h.length >= 3 &&
          h[h.length - 3] > 0 &&
          o.includes("Merchant Payment from") &&
          a++;
      }
      if (
        (b(
          `Quick scan: ${a} potential "Merchant Payment from" transactions found`
        ),
        a === 0)
      ) {
        D(`No "Merchant Payment from" transactions found with Paid In > 0.

Debug:
- Total lines: ${t.length}
- Lines with "Completed": ${t.filter(o => o.includes("Completed")).length}
- Lines with "Merchant Payment": ${t.filter(o => o.includes("Merchant Payment")).length}

The PDF text may not have been extracted correctly. Try the "Manual Text Paste" method: open the PDF in a viewer, select all text, copy, and paste it here.`);
        return;
      }
      const { inflows: s, excluded: d } = De(t),
        n = ge(s, d);
      (E(s),
        $(n),
        b(
          `Done! ${s.length} inflows extracted | Total: Ksh ${u(n.totalAmount, 2)}`
        ),
        Y(
          `Validated: ${s.length} inflows | Ksh ${u(n.totalAmount, 2)} | ${d.length} excluded (loans/charges)`
        ));
    },
    be = async t => {
      (se("AI (Gemini)"), b("Sending to AI for extraction..."));
      const a = await Le(t),
        s = ge(a, []);
      (E(a), $(s), b(`AI complete! ${a.length} inflows found`));
    },
    Ue = t => {
      if (!(t != null && t.length)) return;
      const a = Array.from(t).filter(s =>
        s.name.toLowerCase().endsWith(".pdf")
      );
      a.length && ee(s => [...s, ...a]);
    },
    Oe = t => ee(a => a.filter((s, d) => d !== t)),
    Be = () => {
      if (!M.length) return;
      const t = `Details,Paid In (Ksh),Balance (Ksh),Receipt,Date,Time
`,
        a = M.map(o =>
          [
            `"${(o.details || "").replace(/"/g, '""')}"`,
            o.paidIn.toFixed(2),
            o.balance.toFixed(2),
            o.receipt,
            o.date,
            o.time,
          ].join(",")
        ),
        s = new Blob(
          [
            t +
              a.join(`
`),
          ],
          { type: "text/csv" }
        ),
        d = URL.createObjectURL(s),
        n = document.createElement("a");
      ((n.href = d),
        (n.download = `mpesa_inflows_${new Date().toISOString().split("T")[0]}.csv`),
        n.click(),
        URL.revokeObjectURL(d));
    },
    q = A
      ? M.filter(t => t.details.toLowerCase().includes(A.toLowerCase()))
      : M;
  return e.jsxs("div", {
    className: "space-y-6 max-w-6xl mx-auto",
    children: [
      e.jsxs("div", {
        className: "flex items-center gap-3",
        children: [
          e.jsx("div", {
            className: "p-2.5 bg-green-100 dark:bg-green-900/30 rounded-xl",
            children: e.jsx(Pe, {
              size: 24,
              className: "text-green-600 dark:text-green-400",
            }),
          }),
          e.jsxs("div", {
            children: [
              e.jsx("h2", {
                className: "text-2xl font-bold text-gray-900 dark:text-white",
                children: "M-PESA Inflow Analyzer",
              }),
              e.jsxs("p", {
                className: "text-sm text-gray-500 dark:text-gray-400",
                children: [
                  "Extract ",
                  e.jsx("strong", { children: "Details" }),
                  ", ",
                  e.jsx("strong", { children: "Paid In" }),
                  ", ",
                  e.jsx("strong", { children: "Balance" }),
                  " from M-PESA statements",
                ],
              }),
            ],
          }),
        ],
      }),
      e.jsx("div", {
        className: "flex gap-2",
        children: [
          {
            id: "pdf",
            label: "PDF Upload",
            desc: "Upload PDF files",
            icon: Me,
          },
          {
            id: "paste",
            label: "Manual Paste",
            desc: "Paste copied text",
            icon: Se,
          },
          { id: "ai", label: "AI Only", desc: "Gemini AI extraction", icon: U },
        ].map(({ id: t, label: a, desc: s, icon: d }) =>
          e.jsxs(
            "button",
            {
              onClick: () => Re(t),
              className: `flex-1 px-4 py-3 rounded-xl text-xs font-semibold transition-all ${F === t ? "bg-green-600 text-white shadow-lg" : "bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50"}`,
              children: [
                e.jsx(d, { size: 16, className: "mx-auto mb-1" }),
                e.jsx("div", { children: a }),
                e.jsx("div", {
                  className: "text-[10px] opacity-70 font-normal",
                  children: s,
                }),
              ],
            },
            t
          )
        ),
      }),
      e.jsxs("div", {
        className: "flex gap-2",
        children: [
          e.jsx("p", {
            className: "text-xs text-gray-500 self-center mr-2",
            children: "Extraction:",
          }),
          [
            { mode: "auto", label: "Auto", icon: Ye },
            { mode: "pattern", label: "Pattern", icon: Q },
            { mode: "ai", label: "AI", icon: U },
          ].map(({ mode: t, label: a, icon: s }) =>
            e.jsxs(
              "button",
              {
                onClick: () => Ie(t),
                className: `px-3 py-1.5 rounded-lg text-[11px] font-medium transition-all ${W === t ? "bg-indigo-600 text-white" : "bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400"}`,
                children: [e.jsx(s, { size: 12, className: "inline mr-1" }), a],
              },
              t
            )
          ),
        ],
      }),
      F === "pdf" &&
        e.jsxs("div", {
          className:
            "bg-white dark:bg-gray-800 rounded-2xl border-2 border-dashed border-gray-300 dark:border-gray-600 p-8 text-center",
          children: [
            e.jsx("input", {
              ref: he,
              type: "file",
              accept: ".pdf",
              multiple: !0,
              onChange: t => {
                (Ue(t.target.files), (t.target.value = ""));
              },
              className: "hidden",
            }),
            e.jsx(Me, { size: 36, className: "mx-auto mb-3 text-gray-400" }),
            e.jsx("p", {
              className: "text-sm text-gray-600 dark:text-gray-400 mb-2",
              children: "Upload M-PESA PDF statement(s)",
            }),
            e.jsx("p", {
              className: "text-xs text-gray-400 mb-4",
              children:
                'If PDF extraction fails, switch to "Manual Paste" mode',
            }),
            e.jsx("button", {
              onClick: () => {
                var t;
                return (t = he.current) == null ? void 0 : t.click();
              },
              className:
                "px-6 py-2.5 bg-green-600 hover:bg-green-700 text-white rounded-xl text-sm font-medium transition-colors",
              children: "Select PDF Files",
            }),
            C.length > 0 &&
              e.jsx("div", {
                className: "mt-4 space-y-2 text-left max-w-md mx-auto",
                children: C.map((t, a) =>
                  e.jsxs(
                    "div",
                    {
                      className:
                        "flex items-center justify-between p-2.5 bg-gray-50 dark:bg-gray-700 rounded-lg",
                      children: [
                        e.jsxs("div", {
                          className: "flex items-center gap-2 min-w-0",
                          children: [
                            e.jsx(Pe, {
                              size: 14,
                              className: "text-green-500 flex-shrink-0",
                            }),
                            e.jsx("span", {
                              className: "text-xs dark:text-white truncate",
                              children: t.name,
                            }),
                            e.jsxs("span", {
                              className:
                                "text-[10px] text-gray-400 flex-shrink-0",
                              children: [(t.size / 1024).toFixed(0), " KB"],
                            }),
                          ],
                        }),
                        e.jsx("button", {
                          onClick: () => Oe(a),
                          className:
                            "p-1 text-gray-400 hover:text-red-500 transition-colors flex-shrink-0",
                          children: e.jsx(Ge, { size: 14 }),
                        }),
                      ],
                    },
                    a
                  )
                ),
              }),
            e.jsx("button", {
              onClick: _e,
              disabled: w || C.length === 0,
              className: `mt-4 w-full py-3 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 transition-all ${w || !C.length ? "bg-gray-400 text-white cursor-not-allowed" : "bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700 text-white shadow-lg"}`,
              children: w
                ? e.jsxs(e.Fragment, {
                    children: [
                      e.jsx(J, { size: 18, className: "animate-spin" }),
                      " Processing...",
                    ],
                  })
                : e.jsxs(e.Fragment, {
                    children: [e.jsx(X, { size: 18 }), " Extract Inflows"],
                  }),
            }),
          ],
        }),
      F === "paste" &&
        e.jsxs("div", {
          className:
            "bg-white dark:bg-gray-800 rounded-2xl border-2 border-dashed border-green-300 dark:border-green-700 p-6 space-y-4",
          children: [
            e.jsxs("div", {
              className: "flex items-start gap-3",
              children: [
                e.jsx(Se, {
                  size: 24,
                  className: "text-green-500 flex-shrink-0 mt-1",
                }),
                e.jsxs("div", {
                  children: [
                    e.jsx("p", {
                      className:
                        "text-sm font-semibold text-gray-900 dark:text-white",
                      children: "Manual Text Paste (Most Reliable)",
                    }),
                    e.jsx("p", {
                      className: "text-xs text-gray-500 dark:text-gray-400",
                      children:
                        "Open the M-PESA PDF in any viewer, select all text (Ctrl+A), copy (Ctrl+C), and paste below. This method bypasses browser PDF extraction issues.",
                    }),
                  ],
                }),
              ],
            }),
            e.jsx("textarea", {
              value: N,
              onChange: t => te(t.target.value),
              placeholder: `Paste M-PESA statement text here...

Example format:
TI66P7TDSE 2025-09-06 Merchant Payment from Completed 80.00 0.00 200.00 Customer 578590-
18:26:32 0746***921 - john doe
Merchant Payment
...`,
              className:
                "w-full h-64 px-4 py-3 bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-600 rounded-xl text-xs font-mono dark:text-white focus:ring-2 focus:ring-green-500 outline-none resize-y",
            }),
            e.jsxs("div", {
              className: "flex items-center justify-between",
              children: [
                e.jsxs("p", {
                  className: "text-xs text-gray-400",
                  children: [
                    N.length.toLocaleString(),
                    " characters | ",
                    N.split(
                      `
`
                    ).length.toLocaleString(),
                    " lines",
                  ],
                }),
                e.jsx("button", {
                  onClick: pe,
                  disabled: w || !N.trim(),
                  className: `px-6 py-3 rounded-xl text-sm font-semibold flex items-center gap-2 transition-all ${w || !N.trim() ? "bg-gray-400 text-white cursor-not-allowed" : "bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700 text-white shadow-lg"}`,
                  children: w
                    ? e.jsxs(e.Fragment, {
                        children: [
                          e.jsx(J, { size: 18, className: "animate-spin" }),
                          " Processing...",
                        ],
                      })
                    : e.jsxs(e.Fragment, {
                        children: [e.jsx(X, { size: 18 }), " Extract Inflows"],
                      }),
                }),
              ],
            }),
          ],
        }),
      F === "ai" &&
        e.jsxs("div", {
          className:
            "bg-white dark:bg-gray-800 rounded-2xl border-2 border-dashed border-purple-300 dark:border-purple-700 p-6 space-y-4",
          children: [
            e.jsxs("div", {
              className: "flex items-start gap-3",
              children: [
                e.jsx(U, {
                  size: 24,
                  className: "text-purple-500 flex-shrink-0 mt-1",
                }),
                e.jsxs("div", {
                  children: [
                    e.jsx("p", {
                      className:
                        "text-sm font-semibold text-gray-900 dark:text-white",
                      children: "AI Extraction",
                    }),
                    e.jsx("p", {
                      className: "text-xs text-gray-500 dark:text-gray-400",
                      children:
                        "Paste any M-PESA statement text and let AI extract the inflows. Best for non-standard formats.",
                    }),
                  ],
                }),
              ],
            }),
            e.jsx("textarea", {
              value: N,
              onChange: t => te(t.target.value),
              placeholder:
                "Paste M-PESA statement text here for AI analysis...",
              className:
                "w-full h-64 px-4 py-3 bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-600 rounded-xl text-xs font-mono dark:text-white focus:ring-2 focus:ring-purple-500 outline-none resize-y",
            }),
            e.jsx("button", {
              onClick: pe,
              disabled: w || !N.trim(),
              className: `w-full py-3 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 transition-all ${w || !N.trim() ? "bg-gray-400 text-white cursor-not-allowed" : "bg-gradient-to-r from-purple-600 to-purple-700 hover:from-purple-700 hover:to-purple-800 text-white shadow-lg"}`,
              children: w
                ? e.jsxs(e.Fragment, {
                    children: [
                      e.jsx(J, { size: 18, className: "animate-spin" }),
                      " AI Processing...",
                    ],
                  })
                : e.jsxs(e.Fragment, {
                    children: [e.jsx(U, { size: 18 }), " Extract with AI"],
                  }),
            }),
          ],
        }),
      (H || S.length > 0) &&
        e.jsxs("div", {
          className: "space-y-2",
          children: [
            H &&
              e.jsx("div", {
                className:
                  "bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl p-4",
                children: e.jsxs("div", {
                  className: "flex items-start gap-2",
                  children: [
                    e.jsx(tt, {
                      size: 16,
                      className: "text-amber-500 flex-shrink-0 mt-0.5",
                    }),
                    e.jsx("pre", {
                      className:
                        "text-xs text-amber-800 dark:text-amber-200 whitespace-pre-wrap font-mono",
                      children: H,
                    }),
                  ],
                }),
              }),
            S.length > 0 &&
              e.jsxs("button", {
                onClick: () => Te(!O),
                className:
                  "text-xs text-gray-500 hover:text-gray-700 underline",
                children: [
                  O ? "Hide" : "Show",
                  " extracted raw text (",
                  S.length,
                  " lines)",
                ],
              }),
            O &&
              S.length > 0 &&
              e.jsx("div", {
                className:
                  "bg-gray-900 rounded-xl p-4 max-h-[300px] overflow-y-auto",
                children: e.jsxs("pre", {
                  className:
                    "text-[10px] text-gray-300 font-mono whitespace-pre-wrap",
                  children: [
                    S.slice(0, 100).join(`
`),
                    S.length > 100 &&
                      `
... (${S.length - 100} more lines)`,
                  ],
                }),
              }),
          ],
        }),
      ae.length > 0 &&
        e.jsxs("div", {
          className:
            "bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-xl p-4",
          children: [
            e.jsx("div", {
              className: "space-y-1",
              children: ae.map((t, a) =>
                e.jsx(
                  "p",
                  {
                    className:
                      "text-xs text-blue-800 dark:text-blue-200 font-mono",
                    children: t,
                  },
                  a
                )
              ),
            }),
            re &&
              e.jsxs("p", {
                className: "text-[10px] text-blue-500 mt-2",
                children: ["Method: ", re],
              }),
          ],
        }),
      ne &&
        e.jsxs("div", {
          className:
            "bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-xl p-4 flex items-start gap-2",
          children: [
            e.jsx(Ce, {
              size: 16,
              className: "text-green-500 flex-shrink-0 mt-0.5",
            }),
            e.jsx("p", {
              className: "text-xs text-green-700 dark:text-green-300",
              children: ne,
            }),
          ],
        }),
      l &&
        l.cleanRevenue.totalExcluded > 0 &&
        e.jsxs("div", {
          className:
            "bg-gradient-to-r from-emerald-50 to-green-50 dark:from-emerald-900/10 dark:to-green-900/10 rounded-xl border border-emerald-200 dark:border-emerald-800 p-4",
          children: [
            e.jsxs("div", {
              className: "flex items-center gap-2 mb-3",
              children: [
                e.jsx(He, { size: 18, className: "text-emerald-600" }),
                e.jsx("h3", {
                  className:
                    "text-sm font-bold text-emerald-800 dark:text-emerald-300 uppercase",
                  children: "Clean Revenue Breakdown",
                }),
              ],
            }),
            e.jsxs("div", {
              className: "grid grid-cols-2 sm:grid-cols-4 gap-3 text-center",
              children: [
                e.jsxs("div", {
                  children: [
                    e.jsxs("p", {
                      className:
                        "text-lg font-bold text-emerald-700 dark:text-emerald-400",
                      children: ["Ksh ", u(l.cleanRevenue.genuineRevenue, 0)],
                    }),
                    e.jsx("p", {
                      className: "text-[10px] text-emerald-600",
                      children: "Operating Revenue",
                    }),
                  ],
                }),
                e.jsxs("div", {
                  children: [
                    e.jsxs("p", {
                      className:
                        "text-lg font-bold text-red-600 dark:text-red-400",
                      children: ["Ksh ", u(l.cleanRevenue.excludedLoans, 0)],
                    }),
                    e.jsx("p", {
                      className: "text-[10px] text-red-500",
                      children: "Excluded (Loans)",
                    }),
                  ],
                }),
                e.jsxs("div", {
                  children: [
                    e.jsxs("p", {
                      className:
                        "text-lg font-bold text-orange-600 dark:text-orange-400",
                      children: ["Ksh ", u(l.cleanRevenue.excludedCharges, 0)],
                    }),
                    e.jsx("p", {
                      className: "text-[10px] text-orange-500",
                      children: "Excluded (Charges)",
                    }),
                  ],
                }),
                e.jsxs("div", {
                  children: [
                    e.jsxs("p", {
                      className:
                        "text-lg font-bold text-purple-600 dark:text-purple-400",
                      children: [
                        "Ksh ",
                        u(l.cleanRevenue.excludedTransfers, 0),
                      ],
                    }),
                    e.jsx("p", {
                      className: "text-[10px] text-purple-500",
                      children: "Excluded (Transfers)",
                    }),
                  ],
                }),
              ],
            }),
            e.jsxs("div", {
              className:
                "mt-3 pt-3 border-t border-emerald-200 dark:border-emerald-800 flex items-center justify-between",
              children: [
                e.jsxs("p", {
                  className: "text-xs text-emerald-700 dark:text-emerald-400",
                  children: [
                    e.jsx(Qe, { size: 12, className: "inline mr-1" }),
                    "Excluded items are ",
                    e.jsx("strong", { children: "NOT" }),
                    " operating revenue",
                  ],
                }),
                e.jsxs("button", {
                  onClick: () => Ee(!G),
                  className: "text-xs text-emerald-600 underline",
                  children: [
                    G ? "Hide" : "Show",
                    " excluded (",
                    l.cleanRevenue.excludedRecords.length,
                    ")",
                  ],
                }),
              ],
            }),
          ],
        }),
      G &&
        l &&
        l.cleanRevenue.excludedRecords.length > 0 &&
        e.jsx("div", {
          className:
            "bg-white dark:bg-gray-800 rounded-xl border border-red-200 dark:border-red-800 shadow-sm overflow-hidden",
          children: e.jsx("div", {
            className: "overflow-x-auto max-h-[300px] overflow-y-auto",
            children: e.jsxs("table", {
              className: "w-full text-xs",
              children: [
                e.jsx("thead", {
                  className: "sticky top-0 bg-red-50 dark:bg-red-900/30",
                  children: e.jsxs("tr", {
                    children: [
                      e.jsx("th", {
                        className:
                          "text-left px-3 py-2 text-red-600 dark:text-red-400",
                        children: "Receipt",
                      }),
                      e.jsx("th", {
                        className:
                          "text-left px-3 py-2 text-red-600 dark:text-red-400",
                        children: "Type",
                      }),
                      e.jsx("th", {
                        className:
                          "text-right px-3 py-2 text-red-600 dark:text-red-400",
                        children: "Amount",
                      }),
                      e.jsx("th", {
                        className:
                          "text-left px-3 py-2 text-red-600 dark:text-red-400",
                        children: "Reason",
                      }),
                    ],
                  }),
                }),
                e.jsx("tbody", {
                  children: l.cleanRevenue.excludedRecords.map((t, a) =>
                    e.jsxs(
                      "tr",
                      {
                        className:
                          "border-b border-red-100 dark:border-red-900/20",
                        children: [
                          e.jsx("td", {
                            className:
                              "px-3 py-2 font-mono text-[10px] text-gray-500",
                            children: t.receipt,
                          }),
                          e.jsx("td", {
                            className: "px-3 py-2 capitalize",
                            children: t.type.replace(/_/g, " "),
                          }),
                          e.jsx("td", {
                            className:
                              "px-3 py-2 text-right font-semibold text-red-600",
                            children: u(t.amount, 2),
                          }),
                          e.jsx("td", {
                            className: "px-3 py-2 text-gray-500",
                            children: t.reason,
                          }),
                        ],
                      },
                      a
                    )
                  ),
                }),
              ],
            }),
          }),
        }),
      l &&
        e.jsxs("div", {
          className: "grid grid-cols-2 sm:grid-cols-4 gap-3",
          children: [
            e.jsxs("div", {
              className:
                "bg-white dark:bg-gray-800 rounded-xl p-4 border border-gray-200 dark:border-gray-700 text-center",
              children: [
                e.jsx("p", {
                  className:
                    "text-2xl font-bold text-green-600 dark:text-green-400",
                  children: l.totalInflows.toLocaleString(),
                }),
                e.jsx("p", {
                  className: "text-[10px] text-gray-500",
                  children: "Total Inflows",
                }),
              ],
            }),
            e.jsxs("div", {
              className:
                "bg-white dark:bg-gray-800 rounded-xl p-4 border border-gray-200 dark:border-gray-700 text-center",
              children: [
                e.jsxs("p", {
                  className:
                    "text-2xl font-bold text-blue-600 dark:text-blue-400",
                  children: ["Ksh ", u(l.totalAmount, 0)],
                }),
                e.jsx("p", {
                  className: "text-[10px] text-gray-500",
                  children: "Total Received",
                }),
              ],
            }),
            e.jsxs("div", {
              className:
                "bg-white dark:bg-gray-800 rounded-xl p-4 border border-gray-200 dark:border-gray-700 text-center",
              children: [
                e.jsx("p", {
                  className:
                    "text-2xl font-bold text-purple-600 dark:text-purple-400",
                  children: l.uniqueCustomers,
                }),
                e.jsx("p", {
                  className: "text-[10px] text-gray-500",
                  children: "Unique Customers",
                }),
              ],
            }),
            e.jsxs("div", {
              className:
                "bg-white dark:bg-gray-800 rounded-xl p-4 border border-gray-200 dark:border-gray-700 text-center",
              children: [
                e.jsxs("p", {
                  className:
                    "text-2xl font-bold text-amber-600 dark:text-amber-400",
                  children: ["Ksh ", u(l.averagePayment, 0)],
                }),
                e.jsx("p", {
                  className: "text-[10px] text-gray-500",
                  children: "Average Payment",
                }),
              ],
            }),
          ],
        }),
      l &&
        e.jsxs("div", {
          className: "grid grid-cols-1 sm:grid-cols-2 gap-3",
          children: [
            e.jsxs("div", {
              className:
                "bg-gradient-to-r from-amber-50 to-yellow-50 dark:from-amber-900/10 dark:to-yellow-900/10 rounded-xl p-4 border border-amber-200 dark:border-amber-800",
              children: [
                e.jsx("p", {
                  className: "text-[10px] text-amber-600 font-medium uppercase",
                  children: "Top Customer",
                }),
                e.jsx("p", {
                  className:
                    "text-lg font-bold text-gray-900 dark:text-white mt-1",
                  children: l.topCustomer.name,
                }),
                e.jsxs("p", {
                  className: "text-sm text-amber-700 dark:text-amber-400",
                  children: [
                    "Ksh ",
                    u(l.topCustomer.amount, 0),
                    " across ",
                    l.topCustomer.count,
                    " payment",
                    l.topCustomer.count !== 1 ? "s" : "",
                  ],
                }),
              ],
            }),
            e.jsxs("div", {
              className:
                "bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-900/10 dark:to-indigo-900/10 rounded-xl p-4 border border-blue-200 dark:border-indigo-800",
              children: [
                e.jsx("p", {
                  className: "text-[10px] text-blue-600 font-medium uppercase",
                  children: "Period",
                }),
                e.jsxs("p", {
                  className:
                    "text-lg font-bold text-gray-900 dark:text-white mt-1",
                  children: [
                    l.dateRange.from || "N/A",
                    " to ",
                    l.dateRange.to || "N/A",
                  ],
                }),
                e.jsxs("p", {
                  className: "text-sm text-blue-700 dark:text-blue-400",
                  children: [
                    l.onlinePayments,
                    " online payment",
                    l.onlinePayments !== 1 ? "s" : "",
                  ],
                }),
              ],
            }),
          ],
        }),
      l &&
        l.balanceAnalysis.recordedNet > 0 &&
        e.jsxs("div", {
          className: `rounded-xl border p-4 ${l.balanceAnalysis.hasUnrecorded ? "bg-gradient-to-r from-amber-50 to-orange-50 dark:from-amber-900/10 dark:to-orange-900/10 border-amber-200 dark:border-amber-800" : "bg-gradient-to-r from-emerald-50 to-green-50 dark:from-emerald-900/10 dark:to-green-900/10 border-emerald-200 dark:border-emerald-800"}`,
          children: [
            e.jsxs("div", {
              className: "flex items-center gap-2 mb-3",
              children: [
                e.jsx(Ze, {
                  size: 16,
                  className: l.balanceAnalysis.hasUnrecorded
                    ? "text-amber-500"
                    : "text-emerald-500",
                }),
                e.jsx("h3", {
                  className: "text-sm font-bold text-gray-900 dark:text-white",
                  children: "Balance Analysis: True Inflow",
                }),
                e.jsx("span", {
                  className: `text-[10px] px-2 py-0.5 rounded-full font-medium ${l.balanceAnalysis.hasUnrecorded ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700"}`,
                  children: l.balanceAnalysis.confidence,
                }),
              ],
            }),
            e.jsxs("div", {
              className: "grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3",
              children: [
                e.jsxs("div", {
                  className:
                    "bg-white dark:bg-gray-800 rounded-lg p-3 border border-gray-200 dark:border-gray-700 text-center",
                  children: [
                    e.jsxs("p", {
                      className:
                        "text-lg font-bold text-blue-600 dark:text-blue-400",
                      children: ["Ksh ", u(l.balanceAnalysis.recordedNet, 0)],
                    }),
                    e.jsx("p", {
                      className: "text-[9px] text-gray-500",
                      children: "Recorded Net (Paid In)",
                    }),
                  ],
                }),
                e.jsxs("div", {
                  className:
                    "bg-white dark:bg-gray-800 rounded-lg p-3 border border-gray-200 dark:border-gray-700 text-center",
                  children: [
                    e.jsxs("p", {
                      className:
                        "text-lg font-bold text-emerald-600 dark:text-emerald-400",
                      children: ["Ksh ", u(l.balanceAnalysis.trueInflow, 0)],
                    }),
                    e.jsx("p", {
                      className: "text-[9px] text-gray-500",
                      children: "True Inflow (Balance Delta +)",
                    }),
                  ],
                }),
                e.jsxs("div", {
                  className: `bg-white dark:bg-gray-800 rounded-lg p-3 border text-center ${l.balanceAnalysis.hasUnrecorded ? "border-amber-300 dark:border-amber-700" : "border-gray-200 dark:border-gray-700"}`,
                  children: [
                    e.jsxs("p", {
                      className: `text-lg font-bold ${l.balanceAnalysis.hasUnrecorded ? "text-amber-600 dark:text-amber-400" : "text-gray-600 dark:text-gray-400"}`,
                      children: [
                        "Ksh ",
                        u(l.balanceAnalysis.unrecordedInflow, 0),
                      ],
                    }),
                    e.jsx("p", {
                      className: "text-[9px] text-gray-500",
                      children: "Unrecorded Inflow",
                    }),
                  ],
                }),
                e.jsxs("div", {
                  className:
                    "bg-white dark:bg-gray-800 rounded-lg p-3 border border-gray-200 dark:border-gray-700 text-center",
                  children: [
                    e.jsxs("p", {
                      className:
                        "text-lg font-bold text-purple-600 dark:text-purple-400",
                      children: [l.balanceAnalysis.discrepancy, "%"],
                    }),
                    e.jsx("p", {
                      className: "text-[9px] text-gray-500",
                      children: "Discrepancy Rate",
                    }),
                  ],
                }),
              ],
            }),
            l.balanceAnalysis.hasUnrecorded &&
              e.jsxs("div", {
                className:
                  "flex items-start gap-2 p-2 bg-amber-100 dark:bg-amber-900/20 rounded-lg",
                children: [
                  e.jsx(qe, {
                    size: 14,
                    className: "text-amber-500 flex-shrink-0 mt-0.5",
                  }),
                  e.jsxs("p", {
                    className: "text-[11px] text-amber-700 dark:text-amber-400",
                    children: [
                      e.jsx("strong", { children: "Warning:" }),
                      " The receipt parser detected ",
                      e.jsxs("strong", {
                        children: [
                          "Ksh ",
                          u(l.balanceAnalysis.unrecordedInflow, 0),
                        ],
                      }),
                      " in unrecorded inflows. The statement Balance column shows higher growth than the parsed receipts, suggesting some transactions were omitted or could not be parsed. Consider using the Balance delta method for your financial reporting.",
                    ],
                  }),
                ],
              }),
            !l.balanceAnalysis.hasUnrecorded &&
              l.balanceAnalysis.confidence.includes("High") &&
              e.jsxs("div", {
                className:
                  "flex items-start gap-2 p-2 bg-emerald-100 dark:bg-emerald-900/20 rounded-lg",
                children: [
                  e.jsx(Ce, {
                    size: 14,
                    className: "text-emerald-500 flex-shrink-0 mt-0.5",
                  }),
                  e.jsxs("p", {
                    className:
                      "text-[11px] text-emerald-700 dark:text-emerald-400",
                    children: [
                      e.jsx("strong", { children: "Good:" }),
                      " Recorded inflows match the Balance column. The parser captured all transactions accurately.",
                    ],
                  }),
                ],
              }),
          ],
        }),
      M.length > 0 &&
        e.jsxs("div", {
          className:
            "bg-gradient-to-r from-indigo-50 to-purple-50 dark:from-indigo-900/10 dark:to-purple-900/10 rounded-xl border border-indigo-200 dark:border-indigo-800 p-4",
          children: [
            e.jsxs("button", {
              onClick: () => $e(!Z),
              className:
                "flex items-center gap-2 text-sm font-semibold text-indigo-700 dark:text-indigo-300 mb-2",
              children: [
                e.jsx(Q, { size: 16 }),
                " Range Filter: Total Valid Inflow",
                e.jsx("span", {
                  className: "text-xs text-indigo-500",
                  children: Z ? "(hide)" : "(show)",
                }),
              ],
            }),
            Z &&
              e.jsxs("div", {
                className: "space-y-3",
                children: [
                  e.jsxs("div", {
                    className: "grid grid-cols-1 sm:grid-cols-3 gap-3",
                    children: [
                      e.jsxs("div", {
                        children: [
                          e.jsx("label", {
                            className:
                              "text-[10px] text-gray-500 uppercase mb-1 block",
                            children: "Receipt No (e.g. UED9N3YOMC)",
                          }),
                          e.jsx("input", {
                            type: "text",
                            value: T,
                            onChange: t => le(t.target.value.toUpperCase()),
                            placeholder: "UED9N3YOMC",
                            className:
                              "w-full px-3 py-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-xs font-mono dark:text-white uppercase",
                          }),
                        ],
                      }),
                      e.jsxs("div", {
                        children: [
                          e.jsx("label", {
                            className:
                              "text-[10px] text-gray-500 uppercase mb-1 block",
                            children: "From (Date/Time)",
                          }),
                          e.jsx("input", {
                            type: "datetime-local",
                            value: z,
                            onChange: t => de(t.target.value),
                            className:
                              "w-full px-3 py-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-xs dark:text-white",
                          }),
                        ],
                      }),
                      e.jsxs("div", {
                        children: [
                          e.jsx("label", {
                            className:
                              "text-[10px] text-gray-500 uppercase mb-1 block",
                            children: "To (Date/Time)",
                          }),
                          e.jsx("input", {
                            type: "datetime-local",
                            value: L,
                            onChange: t => oe(t.target.value),
                            className:
                              "w-full px-3 py-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-xs dark:text-white",
                          }),
                        ],
                      }),
                    ],
                  }),
                  e.jsxs("div", {
                    className: "flex gap-2",
                    children: [
                      e.jsxs("button", {
                        onClick: () => {
                          let t = M;
                          if (
                            (T.trim() &&
                              (t = t.filter(s =>
                                s.receipt
                                  .toUpperCase()
                                  .includes(T.toUpperCase())
                              )),
                            z)
                          ) {
                            const s = new Date(z).getTime();
                            t = t.filter(d => {
                              const n = new Date(
                                `${d.date}T${d.time || "00:00:00"}`
                              ).getTime();
                              return !isNaN(n) && n >= s;
                            });
                          }
                          if (L) {
                            const s = new Date(L).getTime();
                            t = t.filter(d => {
                              const n = new Date(
                                `${d.date}T${d.time || "23:59:59"}`
                              ).getTime();
                              return !isNaN(n) && n <= s;
                            });
                          }
                          const a = t.reduce((s, d) => s + d.paidIn, 0);
                          (ce(a), me(t.length));
                        },
                        className:
                          "px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-semibold flex items-center gap-2",
                        children: [e.jsx(Q, { size: 14 }), " Calculate Total"],
                      }),
                      e.jsxs("button", {
                        onClick: () => {
                          (le(""), de(""), oe(""), ce(null), me(0));
                        },
                        className:
                          "px-4 py-2 bg-gray-200 hover:bg-gray-300 text-gray-700 rounded-lg text-xs font-semibold flex items-center gap-2",
                        children: [e.jsx(Ve, { size: 14 }), " Reset"],
                      }),
                    ],
                  }),
                  ie !== null &&
                    e.jsxs("div", {
                      className:
                        "p-3 bg-white dark:bg-gray-800 rounded-lg border border-indigo-200",
                      children: [
                        e.jsx("p", {
                          className: "text-xs text-gray-500",
                          children: "Filtered Result:",
                        }),
                        e.jsxs("p", {
                          className:
                            "text-xl font-bold text-indigo-700 dark:text-indigo-400",
                          children: ["Ksh ", u(ie, 2)],
                        }),
                        e.jsxs("p", {
                          className: "text-xs text-gray-500",
                          children: [
                            "from ",
                            xe,
                            " transaction",
                            xe !== 1 ? "s" : "",
                            T ? ` matching receipt "${T}"` : "",
                            z || L ? " within time range" : "",
                          ],
                        }),
                      ],
                    }),
                ],
              }),
          ],
        }),
      M.length > 0 &&
        e.jsxs(e.Fragment, {
          children: [
            e.jsxs("div", {
              className:
                "flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3",
              children: [
                e.jsxs("h3", {
                  className:
                    "text-lg font-bold text-gray-900 dark:text-white flex items-center gap-2",
                  children: [
                    e.jsx(X, { size: 18, className: "text-green-500" }),
                    "Inflows (",
                    q.length.toLocaleString(),
                    A ? ` of ${M.length.toLocaleString()}` : "",
                    ")",
                  ],
                }),
                e.jsxs("div", {
                  className: "flex gap-2",
                  children: [
                    e.jsx("input", {
                      type: "text",
                      value: A,
                      onChange: t => Fe(t.target.value),
                      placeholder: "Search customers...",
                      className:
                        "px-3 py-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg text-sm dark:text-white w-48",
                    }),
                    e.jsxs("button", {
                      onClick: Be,
                      className:
                        "px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm font-medium flex items-center gap-2",
                      children: [e.jsx(Je, { size: 14 }), " CSV"],
                    }),
                  ],
                }),
              ],
            }),
            e.jsxs("div", {
              className:
                "bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden",
              children: [
                e.jsx("div", {
                  className: "overflow-x-auto max-h-[600px] overflow-y-auto",
                  children: e.jsxs("table", {
                    className: "w-full text-xs",
                    children: [
                      e.jsx("thead", {
                        className:
                          "sticky top-0 bg-gray-100 dark:bg-gray-700 z-10",
                        children: e.jsxs("tr", {
                          className:
                            "border-b border-gray-200 dark:border-gray-600",
                          children: [
                            e.jsx("th", {
                              className:
                                "text-left px-3 py-2.5 font-semibold text-gray-600 dark:text-gray-300 w-[50%]",
                              children: "Details",
                            }),
                            e.jsx("th", {
                              className:
                                "text-right px-3 py-2.5 font-semibold text-gray-600 dark:text-gray-300",
                              children: "Paid In",
                            }),
                            e.jsx("th", {
                              className:
                                "text-right px-3 py-2.5 font-semibold text-gray-600 dark:text-gray-300",
                              children: "Balance",
                            }),
                            e.jsx("th", {
                              className:
                                "text-left px-3 py-2.5 font-semibold text-gray-600 dark:text-gray-300",
                              children: "Receipt",
                            }),
                            e.jsx("th", {
                              className:
                                "text-left px-3 py-2.5 font-semibold text-gray-600 dark:text-gray-300",
                              children: "Date",
                            }),
                          ],
                        }),
                      }),
                      e.jsx("tbody", {
                        children: q.map((t, a) =>
                          e.jsxs(
                            "tr",
                            {
                              className:
                                "border-b border-gray-100 dark:border-gray-700/50 hover:bg-green-50 dark:hover:bg-green-900/10",
                              children: [
                                e.jsx("td", {
                                  className:
                                    "px-3 py-2 text-gray-800 dark:text-gray-200",
                                  children: e.jsxs("div", {
                                    className: "flex items-center gap-1.5",
                                    children: [
                                      t.isOnline &&
                                        e.jsx("span", {
                                          className:
                                            "text-[9px] px-1 py-0.5 bg-blue-100 text-blue-700 rounded",
                                          children: "Online",
                                        }),
                                      e.jsx("span", { children: t.details }),
                                    ],
                                  }),
                                }),
                                e.jsx("td", {
                                  className:
                                    "px-3 py-2 text-right font-semibold text-green-700 dark:text-green-400",
                                  children: u(t.paidIn, 2),
                                }),
                                e.jsx("td", {
                                  className:
                                    "px-3 py-2 text-right text-gray-500 dark:text-gray-400",
                                  children: u(t.balance, 2),
                                }),
                                e.jsx("td", {
                                  className:
                                    "px-3 py-2 font-mono text-[10px] text-gray-400",
                                  children: t.receipt,
                                }),
                                e.jsxs("td", {
                                  className:
                                    "px-3 py-2 text-gray-500 dark:text-gray-400 whitespace-nowrap",
                                  children: [t.date, " ", t.time],
                                }),
                              ],
                            },
                            a
                          )
                        ),
                      }),
                    ],
                  }),
                }),
                q.length === 0 &&
                  A &&
                  e.jsxs("p", {
                    className: "text-center text-sm text-gray-400 py-8",
                    children: ['No matches for "', A, '"'],
                  }),
              ],
            }),
          ],
        }),
    ],
  });
}
export { it as default };
