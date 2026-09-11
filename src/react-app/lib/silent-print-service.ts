/**
 * Silent Print Service - Background printing without user interaction
 *
 * Features:
 * - Queue-based print management
 * - Error recovery and retry logic
 * - Background printing without popup dialogs
 * - Support for receipts, reports, and documents
 * - Offline-first with local queuing
 * - IndexedDB persistence for print queue
 *
 * Uses unified currency symbols from config/pricing.ts
 */

import { cloudStorage } from "./cloudStorage";
import type { ReceiptData, getReceiptCurrency } from "./pos/printer-service";
import {
  printerService,
  getReceiptCurrency as getCurrencyInfo,
} from "./pos/printer-service";
import { getCurrencySymbol } from "./currency";
import { getFuelLabel } from "@/react-app/config/pricing";

const CloudStorage = cloudStorage;

export interface SilentPrintJob {
  id: string;
  type:
    "receipt" | "report" | "document" | "label" | "invoice" | "sales-report";
  content: any;
  status: "pending" | "processing" | "completed" | "failed";
  retries: number;
  maxRetries: number;
  createdAt: string;
  completedAt?: string;
  error?: string;
  printerId?: string;
  settings?: PrintSettings;
  metadata?: {
    stationId?: string;
    userId?: string;
    transactionId?: string;
    offlineCreated?: boolean;
  };
}

export interface PrintSettings {
  printerId?: string;
  paperWidth?: number;
  copies?: number;
  layout?: "portrait" | "landscape";
  quality?: "draft" | "normal" | "high";
  silent?: boolean;
  timeout?: number;
  autoRetry?: boolean;
  fallbackToBrowser?: boolean;
}

const DEFAULT_SETTINGS: PrintSettings = {
  paperWidth: 80,
  copies: 1,
  layout: "portrait",
  quality: "normal",
  silent: true,
  timeout: 30000,
  autoRetry: true,
  fallbackToBrowser: true,
};

const QUEUE_KEY = "fuelpro_print_queue";
const HISTORY_KEY = "fuelpro_print_history";
const MAX_QUEUE_SIZE = 100;

// IndexedDB for robust offline storage
const DB_NAME = "fuelpro_print_db";
const DB_VERSION = 1;
const STORE_NAME = "print_jobs";

class IndexedDBPrintStore {
  private db: IDBDatabase | null = null;

  async init(): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this.db = request.result;
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: "id" });
          store.createIndex("status", "status", { unique: false });
          store.createIndex("createdAt", "createdAt", { unique: false });
          store.createIndex("type", "type", { unique: false });
        }
      };
    });
  }

  async saveJob(job: SilentPrintJob): Promise<void> {
    if (!this.db) await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const request = store.put(job);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  }

  async getJob(id: string): Promise<SilentPrintJob | undefined> {
    if (!this.db) await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const request = store.get(id);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
  }

  async getAllJobs(): Promise<SilentPrintJob[]> {
    if (!this.db) await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const request = store.getAll();
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result || []);
    });
  }

  async deleteJob(id: string): Promise<void> {
    if (!this.db) await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const request = store.delete(id);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  }

  async clear(): Promise<void> {
    if (!this.db) await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const request = store.clear();
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  }

  async getJobsByStatus(
    status: SilentPrintJob["status"],
  ): Promise<SilentPrintJob[]> {
    if (!this.db) await this.init();
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const index = store.index("status");
      const request = index.getAll(status);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result || []);
    });
  }
}

class SilentPrintService {
  private queue: SilentPrintJob[] = [];
  private isProcessing = false;
  private processTimer: ReturnType<typeof setInterval> | null = null;
  private dbStore: IndexedDBPrintStore;
  private isOnline = typeof navigator !== "undefined" ? navigator.onLine : true;
  private listeners: Set<(status: PrintServiceStatus) => void> = new Set();

  constructor() {
    this.dbStore = new IndexedDBPrintStore();
    this.init();
  }

  private async init(): Promise<void> {
    try {
      await this.dbStore.init();
      await this.loadQueue();
      this.startAutoProcessing();
      this.setupOnlineListener();
    } catch (e) {
      console.error("Failed to initialize print service:", e);
      // Fallback to localStorage-based queue
      this.loadQueueFromLocalStorage();
    }
  }

  private setupOnlineListener(): void {
    if (typeof window === "undefined") return;

    window.addEventListener("online", () => {
      this.isOnline = true;
      this.notifyListeners();
      // Retry failed jobs when back online
      this.processOfflineQueue();
    });

    window.addEventListener("offline", () => {
      this.isOnline = false;
      this.notifyListeners();
    });
  }

  private async processOfflineQueue(): Promise<void> {
    const failedJobs = await this.dbStore.getJobsByStatus("failed");
    for (const job of failedJobs) {
      job.status = "pending";
      job.retries = 0;
      await this.dbStore.saveJob(job);
    }
    this.processPrintQueue();
  }

  /**
   * Subscribe to print service status changes
   */
  subscribe(callback: (status: PrintServiceStatus) => void): () => void {
    this.listeners.add(callback);
    callback(this.getStatus());
    return () => this.listeners.delete(callback);
  }

  private notifyListeners(): void {
    const status = this.getStatus();
    this.listeners.forEach((cb) => cb(status));
  }

  /**
   * Queue a print job for silent printing
   */
  async queuePrint(
    content: any,
    type: SilentPrintJob["type"] = "document",
    settings?: PrintSettings,
  ): Promise<string> {
    const jobId = `print-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const job: SilentPrintJob = {
      id: jobId,
      type,
      content,
      status: "pending",
      retries: 0,
      maxRetries: settings?.autoRetry !== false ? 3 : 0,
      createdAt: new Date().toISOString(),
      settings: { ...DEFAULT_SETTINGS, ...settings },
      metadata: {
        stationId: this.getStationId(),
        userId: this.getUserId(),
        offlineCreated: !this.isOnline,
      },
    };

    // Save to IndexedDB immediately for persistence
    try {
      await this.dbStore.saveJob(job);
    } catch (e) {
      console.warn(
        "Failed to save to IndexedDB, using localStorage fallback:",
        e,
      );
    }

    this.queue.push(job);
    this.saveQueueToLocalStorage();

    // Log to audit if available
    try {
      const cloudStorage = (await import("./cloudStorage")) as any;
      await cloudStorage.logAudit({
        stationId: this.getStationId(),
        action: "print_queued",
        category: "data",
        details: `Queued ${type} print job (offline: ${!this.isOnline})`,
      });
    } catch (e) {
      console.debug("Audit log unavailable for print job");
    }

    // Process immediately if not already processing
    if (!this.isProcessing && this.queue.length <= 10) {
      this.processPrintQueue();
    }

    return job.id;
  }

  /**
   * Queue a receipt for silent printing
   */
  async queueReceipt(
    receipt: ReceiptData,
    printerId?: string,
  ): Promise<string> {
    return this.queuePrint(receipt, "receipt", { printerId });
  }

  /**
   * Queue an invoice for printing
   */
  async queueInvoice(invoiceData: any, printerId?: string): Promise<string> {
    return this.queuePrint(invoiceData, "invoice", { printerId });
  }

  /**
   * Queue a sales report for printing
   */
  async queueSalesReport(reportData: any, printerId?: string): Promise<string> {
    return this.queuePrint(reportData, "sales-report", { printerId });
  }

  /**
   * Queue a report for printing
   */
  async queueReport(reportHtml: string, reportName: string): Promise<string> {
    return this.queuePrint({ html: reportHtml, name: reportName }, "report");
  }

  /**
   * Process the print queue
   */
  private async processPrintQueue(): Promise<void> {
    if (this.isProcessing || this.queue.length === 0) return;

    this.isProcessing = true;
    this.notifyListeners();

    while (this.queue.length > 0) {
      const job = this.queue[0];

      try {
        job.status = "processing";
        await this.saveJobStatus(job);
        this.saveQueueToLocalStorage();
        this.notifyListeners();

        await this.executePrintJob(job);

        job.status = "completed";
        job.completedAt = new Date().toISOString();
        this.queue.shift();
        await this.dbStore.deleteJob(job.id);
        await this.addToHistory(job);
      } catch (error) {
        job.retries++;

        if (job.retries < job.maxRetries) {
          job.status = "pending";
          job.error = error instanceof Error ? error.message : "Unknown error";
          await this.saveJobStatus(job);
          this.saveQueueToLocalStorage();
          // Wait before retry
          await new Promise((resolve) => setTimeout(resolve, 2000));
        } else {
          job.status = "failed";
          job.error =
            error instanceof Error ? error.message : "Max retries exceeded";
          this.queue.shift();
          await this.dbStore.deleteJob(job.id);
          await this.addToHistory(job);
          console.error(
            `Print job ${job.id} failed after ${job.retries} retries:`,
            job.error,
          );
        }
      }
    }

    this.isProcessing = false;
    this.notifyListeners();
  }

  private async saveJobStatus(job: SilentPrintJob): Promise<void> {
    try {
      await this.dbStore.saveJob(job);
    } catch (e) {
      console.warn("Failed to update job in IndexedDB:", e);
    }
  }

  /**
   * Execute a single print job
   */
  private async executePrintJob(job: SilentPrintJob): Promise<void> {
    const settings = job.settings || DEFAULT_SETTINGS;

    switch (job.type) {
      case "receipt":
        await this.printReceipt(job.content, settings);
        break;
      case "invoice":
        await this.printInvoice(job.content, settings);
        break;
      case "sales-report":
        await this.printSalesReport(job.content, settings);
        break;
      case "report":
        await this.printReport(job.content, settings);
        break;
      case "document":
        await this.printDocument(job.content, settings);
        break;
      case "label":
        await this.printLabel(job.content, settings);
        break;
      default:
        throw new Error(`Unknown print type: ${job.type}`);
    }
  }

  /**
   * Print a receipt silently
   */
  private async printReceipt(
    receipt: ReceiptData,
    settings: PrintSettings,
  ): Promise<void> {
    try {
      const printerId = settings.printerId || undefined;
      await printerService.printReceipt(receipt, printerId);

      // Wait for print to complete with timeout
      return new Promise((resolve, reject) => {
        const timeoutId = setTimeout(
          () => reject(new Error("Print timeout")),
          settings.timeout || 30000,
        );

        const checkStatus = setInterval(() => {
          const status = printerService.getQueueStatus();
          if (status.printing === false && status.pending === 0) {
            clearInterval(checkStatus);
            clearTimeout(timeoutId);
            resolve();
          }
        }, 100);
      });
    } catch (error) {
      if (settings.fallbackToBrowser !== false) {
        console.warn(
          "Printer service failed, using browser print fallback:",
          error,
        );
        return this.printReceiptBrowser(receipt, settings);
      }
      throw new Error(`Receipt print failed: ${error}`);
    }
  }

  /**
   * Browser fallback for receipt printing
   */
  private printReceiptBrowser(
    receipt: ReceiptData,
    settings: PrintSettings,
  ): void {
    const receiptHTML = this.generateReceiptHTML(receipt);
    this.printHTML(receiptHTML, settings);
  }

  /**
   * Generate receipt HTML
   */
  private generateReceiptHTML(receipt: ReceiptData): string {
    const logoHTML = receipt.logoUrl
      ? `<img src="${receipt.logoUrl}" alt="Logo" style="max-width: 150px; max-height: 60px; margin-bottom: 3mm; object-fit: contain;" crossorigin="anonymous"/><br/>`
      : "";
    return `
      <div style="font-family: 'Courier New', monospace; width: ${receipt.settings?.paperWidth || 80}mm; padding: 2mm; margin: 0 auto;">
        <div style="text-align: center; margin-bottom: 5mm;">
          ${logoHTML}
          <strong style="font-size: 14pt;">${receipt.stationName}</strong><br/>
          ${receipt.stationLocation}${receipt.stationPhone ? `<br/>Tel: ${receipt.stationPhone}` : ""}
          ${receipt.stationEmail ? `<br/>Email: ${receipt.stationEmail}` : ""}
        </div>
        <div style="border-top: 1px dashed #000; border-bottom: 1px dashed #000; padding: 3mm 0; margin: 3mm 0;">
          Receipt #: ${receipt.receiptNumber}<br/>
          Date: ${receipt.date} Time: ${receipt.time}<br/>
          ${receipt.transactionRef ? `Ref: ${receipt.transactionRef}<br/>` : ""}
          ${receipt.customerName ? `Customer: ${receipt.customerName}<br/>` : ""}
          Attendant: ${receipt.attendantName}
        </div>
        <div style="padding: 2mm 0;">
          <div style="display: flex; justify-content: space-between; font-weight: bold; border-bottom: 1px solid #000; padding-bottom: 2mm; margin-bottom: 2mm;">
            <span>ITEM</span><span>TOTAL</span>
          </div>
          ${receipt.items
            .map(
              (item) => `
            <div style="display: flex; justify-content: space-between; padding: 1mm 0;">
              <span>${item.name} x${item.quantity}</span>
              <span>${getCurrencySymbol(receipt.currencyCode) || getCurrencySymbol()} ${item.total.toLocaleString()}</span>
            </div>
          `,
            )
            .join("")}
        </div>
        <div style="border-top: 1px dashed #000; padding-top: 3mm; margin-top: 3mm;">
          <div style="display: flex; justify-content: space-between;">Subtotal: <span>${getCurrencySymbol(receipt.currencyCode) || getCurrencySymbol()} ${receipt.subtotal.toLocaleString()}</span></div>
          ${receipt.discount > 0 ? `<div style="display: flex; justify-content: space-between;">Discount: <span>-${getCurrencySymbol(receipt.currencyCode) || getCurrencySymbol()} ${receipt.discount.toLocaleString()}</span></div>` : ""}
          ${receipt.tax > 0 ? `<div style="display: flex; justify-content: space-between;">Tax (VAT): <span>${getCurrencySymbol(receipt.currencyCode) || getCurrencySymbol()} ${receipt.tax.toLocaleString()}</span></div>` : ""}
          <div style="display: flex; justify-content: space-between; font-weight: bold; font-size: 12pt; margin-top: 2mm;">
            <span>TOTAL:</span><span>${getCurrencySymbol(receipt.currencyCode) || getCurrencySymbol()} ${receipt.total.toLocaleString()}</span>
          </div>
        </div>
        <div style="border-top: 1px dashed #000; padding-top: 3mm; margin-top: 3mm;">
          <div style="display: flex; justify-content: space-between;">Payment: <span>${receipt.paymentMethod?.toUpperCase()}</span></div>
          <div style="display: flex; justify-content: space-between;">Paid: <span>${getCurrencySymbol(receipt.currencyCode) || getCurrencySymbol()} ${receipt.amountPaid.toLocaleString()}</span></div>
          ${receipt.change > 0 ? `<div style="display: flex; justify-content: space-between; font-weight: bold;">CHANGE: <span>${getCurrencySymbol(receipt.currencyCode) || getCurrencySymbol()} ${receipt.change.toLocaleString()}</span></div>` : ""}
        </div>
        <div style="text-align: center; margin-top: 5mm; font-size: 8pt;">
          ${receipt.footerMessage || "E&OE. Prices include VAT where applicable."}<br/>
          Thank you for your business!
        </div>
      </div>
    `;
  }

  /**
   * Print invoice silently
   */
  private async printInvoice(
    invoiceData: any,
    settings: PrintSettings,
  ): Promise<void> {
    try {
      // Try hardware printer first
      const printerId = settings.printerId || undefined;
      const receipt: ReceiptData = {
        stationName:
          invoiceData.stationName || invoiceData.companyName || "FuelPro",
        stationLocation:
          invoiceData.stationLocation || invoiceData.address || "",
        receiptNumber: invoiceData.invoiceNumber || `INV-${Date.now()}`,
        date: invoiceData.date || new Date().toLocaleDateString(),
        time: invoiceData.time || new Date().toLocaleTimeString(),
        items: invoiceData.items || [],
        subtotal: invoiceData.subtotal || 0,
        tax: invoiceData.tax || 0,
        discount: invoiceData.discount || 0,
        total: invoiceData.total || invoiceData.totalDue || 0,
        paymentMethod: invoiceData.paymentMethod || "INVOICE",
        amountPaid: invoiceData.amountPaid || 0,
        change: 0,
        customerName: invoiceData.customerName,
        attendantName: invoiceData.attendantName || "System",
        footerMessage: "Thank you for your business",
      };
      await printerService.printReceipt(receipt, printerId);
    } catch (error) {
      if (settings.fallbackToBrowser !== false) {
        const invoiceHTML = this.generateInvoiceHTML(invoiceData);
        this.printHTML(invoiceHTML, settings);
      } else {
        throw error;
      }
    }
  }

  /**
   * Generate invoice HTML
   */
  private generateInvoiceHTML(invoiceData: any): string {
    return `
      <div style="font-family: Arial, sans-serif; width: 210mm; padding: 20px; margin: 0 auto;">
        <div style="text-align: center; margin-bottom: 30px;">
          <h1 style="margin: 0;">${invoiceData.stationName || invoiceData.companyName || "INVOICE"}</h1>
          <p>${invoiceData.stationLocation || invoiceData.address || ""}</p>
        </div>
        <div style="margin-bottom: 20px;">
          <strong>Invoice #:</strong> ${invoiceData.invoiceNumber || "N/A"}<br/>
          <strong>Date:</strong> ${invoiceData.date || new Date().toLocaleDateString()}<br/>
          ${invoiceData.customerName ? `<strong>Customer:</strong> ${invoiceData.customerName}<br/>` : ""}
          ${invoiceData.customerAddress ? `<strong>Address:</strong> ${invoiceData.customerAddress}<br/>` : ""}
        </div>
        <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
          <thead>
            <tr style="background: #f0f0f0;">
              <th style="border: 1px solid #ddd; padding: 8px;">Description</th>
              <th style="border: 1px solid #ddd; padding: 8px;">Qty</th>
              <th style="border: 1px solid #ddd; padding: 8px;">Price</th>
              <th style="border: 1px solid #ddd; padding: 8px;">Total</th>
            </tr>
          </thead>
          <tbody>
            ${(invoiceData.items || [])
              .map(
                (item: any) => `
              <tr>
                <td style="border: 1px solid #ddd; padding: 8px;">${item.desc || item.name || ""}</td>
                <td style="border: 1px solid #ddd; padding: 8px;">${item.qty || 1}</td>
                <td style="border: 1px solid #ddd; padding: 8px;">${getCurrencySymbol(invoiceData.currencyCode || invoiceData.currency) || getCurrencySymbol()} ${(item.price || 0).toLocaleString()}</td>
                <td style="border: 1px solid #ddd; padding: 8px;">${getCurrencySymbol(invoiceData.currencyCode || invoiceData.currency) || getCurrencySymbol()} ${(item.total || item.qty * item.price || 0).toLocaleString()}</td>
              </tr>
            `,
              )
              .join("")}
          </tbody>
        </table>
        <div style="text-align: right;">
          <p><strong>Subtotal:</strong> ${getCurrencySymbol(invoiceData.currencyCode || invoiceData.currency) || getCurrencySymbol()} ${(invoiceData.subtotal || 0).toLocaleString()}</p>
          ${invoiceData.tax > 0 ? `<p><strong>Tax:</strong> ${getCurrencySymbol(invoiceData.currencyCode || invoiceData.currency) || getCurrencySymbol()} ${invoiceData.tax.toLocaleString()}</p>` : ""}
          <p style="font-size: 16pt;"><strong>Total Due:</strong> ${getCurrencySymbol(invoiceData.currencyCode || invoiceData.currency) || getCurrencySymbol()} ${(invoiceData.total || invoiceData.totalDue || 0).toLocaleString()}</p>
        </div>
      </div>
    `;
  }

  /**
   * Print sales report silently
   */
  private async printSalesReport(
    reportData: any,
    settings: PrintSettings,
  ): Promise<void> {
    const reportHTML = this.generateSalesReportHTML(reportData);
    this.printHTML(reportHTML, settings);
  }

  /**
   * Generate sales report HTML — DYNAMIC fuel-type columns (was hardcoded
   * Petrol Sales + Diesel Sales). Iterates reportData.fuelTypes if provided;
   * otherwise falls back to reading entry.fuelSales keys from the first entry.
   */
  private generateSalesReportHTML(reportData: any): string {
    const cur = reportData.currency || getCurrencySymbol();
    // Derive the list of fuel types from the report data (dynamic).
    const fuelTypes: string[] =
      Array.isArray(reportData.fuelTypes) && reportData.fuelTypes.length > 0
        ? reportData.fuelTypes
        : (() => {
            const first = (reportData.entries || []).find(
              (e: any) => e.fuelSales && typeof e.fuelSales === "object",
            );
            return first ? Object.keys(first.fuelSales) : ["petrol", "diesel"];
          })();
    const fuelHeaders = fuelTypes
      .map(
        (ft) =>
          `<th style="border: 1px solid #ddd; padding: 8px;">${getFuelLabel(ft)} Sales</th>`,
      )
      .join("");
    return `
      <div style="font-family: Arial, sans-serif; width: 210mm; padding: 20px; margin: 0 auto;">
        <div style="text-align: center; margin-bottom: 30px;">
          <h1>${reportData.stationName || ""}</h1>
          <h2>Sales Report - ${reportData.monthYear || reportData.period || ""}</h2>
        </div>
        <table style="width: 100%; border-collapse: collapse;">
          <thead>
            <tr style="background: #f0f0f0;">
              <th style="border: 1px solid #ddd; padding: 8px;">Date</th>
              ${fuelHeaders}
              <th style="border: 1px solid #ddd; padding: 8px;">Total</th>
            </tr>
          </thead>
          <tbody>
            ${(reportData.entries || [])
              .map(
                (entry: any) => `
              <tr>
                <td style="border: 1px solid #ddd; padding: 8px;">${entry.date}</td>
                ${fuelTypes
                  .map(
                    (ft) =>
                      `<td style="border: 1px solid #ddd; padding: 8px;">${cur} ${((entry.fuelSales && entry.fuelSales[ft]) || 0).toLocaleString()}</td>`,
                  )
                  .join("")}
                <td style="border: 1px solid #ddd; padding: 8px;">${cur} ${(entry.totalSales || 0).toLocaleString()}</td>
              </tr>
            `,
              )
              .join("")}
          </tbody>
          <tfoot>
            <tr style="font-weight: bold; background: #e0e0e0;">
              <td style="border: 1px solid #ddd; padding: 8px;">TOTAL</td>
              ${fuelTypes
                .map(
                  (ft) =>
                    `<td style="border: 1px solid #ddd; padding: 8px;">${cur} ${((reportData.totals && (reportData.totals[ft] || reportData.totals.fuelTotals?.[ft])) || 0).toLocaleString()}</td>`,
                )
                .join("")}
              <td style="border: 1px solid #ddd; padding: 8px;">${cur} ${(reportData.totals?.total || 0).toLocaleString()}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    `;
  }

  /**
   * Print HTML content silently using iframe
   */
  private printHTML(html: string, settings: PrintSettings): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        const iframe = document.createElement("iframe");
        iframe.id = "fuelpro-print-frame";
        iframe.style.cssText =
          "position: absolute; width: 0; height: 0; left: -9999px; top: -9999px;";
        document.body.appendChild(iframe);

        const iframeDoc =
          iframe.contentDocument || iframe.contentWindow?.document;
        if (!iframeDoc) {
          document.body.removeChild(iframe);
          reject(new Error("Cannot access iframe document"));
          return;
        }

        iframeDoc.open();
        iframeDoc.write(`
          <!DOCTYPE html>
          <html>
            <head>
              <title>FuelPro Print</title>
              <style>
                @page { size: auto; margin: 10mm; }
                /* On-screen: render the document in the calm dark theme when the
                   app is dark, so previews match the reblended UI. Physical print
                   stays light (white paper, black text) via @media print below. */
                :root {
                  --fp-bg-main: #0a0e17;
                  --fp-bg-card: #111625;
                  --fp-bg-input: #1a1f2e;
                  --fp-border: #1f2635;
                  --fp-border-lighter: #252c3f;
                  --fp-text: #e7ebf1;
                  --fp-text-sec: #8a94a6;
                  --fp-text-muted: #5b6478;
                  --fp-gold: #c5a059;
                }
                html.fp-dark, html.fp-dark body {
                  background: var(--fp-bg-main) !important;
                  color: var(--fp-text) !important;
                }
                html.fp-dark body { font-family: Arial, sans-serif; }
                html.fp-dark .fp-doc {
                  background: var(--fp-bg-card) !important;
                  color: var(--fp-text) !important;
                  border-color: var(--fp-border) !important;
                }
                html.fp-dark h1, html.fp-dark h2, html.fp-dark strong {
                  color: #ffffff !important;
                }
                html.fp-dark table, html.fp-dark td, html.fp-dark th {
                  border-color: var(--fp-border) !important;
                  color: var(--fp-text) !important;
                }
                html.fp-dark thead tr, html.fp-dark tr[style*="background: #f0f0f0"],
                html.fp-dark tfoot tr, html.fp-dark tr[style*="background: #e0e0e0"] {
                  background: var(--fp-bg-input) !important;
                }
                html.fp-dark td[style*="border: 1px dashed #000"],
                html.fp-dark div[style*="border: 1px dashed #000"],
                html.fp-dark div[style*="border-top: 1px dashed #000"],
                html.fp-dark div[style*="border-bottom: 1px dashed #000"] {
                  border-color: var(--fp-border-lighter) !important;
                }
                html.fp-dark div[style*="border-bottom: 1px solid #000"] {
                  border-color: var(--fp-border-lighter) !important;
                }
                @media print {
                  html.fp-dark, html.fp-dark body {
                    background: #ffffff !important;
                    color: #000000 !important;
                  }
                  html.fp-dark .fp-doc,
                  html.fp-dark table, html.fp-dark td, html.fp-dark th,
                  html.fp-dark h1, html.fp-dark h2, html.fp-dark strong {
                    background: #ffffff !important;
                    color: #000000 !important;
                    border-color: #999999 !important;
                  }
                  html.fp-dark thead tr, html.fp-dark tfoot tr {
                    background: #f0f0f0 !important;
                  }
                  html.fp-dark div[style*="border: 1px dashed #000"],
                  html.fp-dark div[style*="border-top: 1px dashed #000"],
                  html.fp-dark div[style*="border-bottom: 1px dashed #000"],
                  html.fp-dark div[style*="border-bottom: 1px solid #000"],
                  html.fp-dark td[style*="border: 1px dashed #000"] {
                    border-color: #000000 !important;
                  }
                  body { margin: 0; padding: 0; }
                  * { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
                }
                body { font-family: Arial, sans-serif; }
              </style>
            </head>
            <body class="fp-doc-body">${html}</body>
          </html>
        `);
        // Apply dark mode to the print document when the app is dark.
        const rootDark =
          typeof document !== "undefined" &&
          document.documentElement.classList.contains("dark");
        if (rootDark) iframeDoc.documentElement.classList.add("fp-dark");
        // Wrap generated content so .fp-doc rules target it.
        const bodyEl = iframeDoc.body;
        if (bodyEl) bodyEl.classList.add("fp-doc");
        iframeDoc.close();

        iframe.onload = () => {
          const timeout = settings.timeout || 30000;
          const timer = setTimeout(() => {
            document.body.removeChild(iframe);
            resolve(); // Resolve anyway, print may have happened
          }, timeout);

          try {
            iframe.contentWindow?.print();

            // Listen for print completion
            iframe.contentWindow?.addEventListener("afterprint", () => {
              clearTimeout(timer);
              document.body.removeChild(iframe);
              resolve();
            });

            // Fallback: assume print completes after delay
            setTimeout(() => {
              clearTimeout(timer);
              if (document.body.contains(iframe)) {
                document.body.removeChild(iframe);
              }
              resolve();
            }, 2000);
          } catch (error) {
            clearTimeout(timer);
            document.body.removeChild(iframe);
            reject(error);
          }
        };

        iframe.onerror = () => {
          document.body.removeChild(iframe);
          reject(new Error("Failed to load print frame"));
        };
      } catch (error) {
        reject(new Error(`Print failed: ${error}`));
      }
    });
  }

  /**
   * Print a report silently
   */
  private async printReport(
    report: { html: string; name: string },
    settings: PrintSettings,
  ): Promise<void> {
    return this.printHTML(report.html, settings);
  }

  /**
   * Print a generic document
   */
  private async printDocument(
    content: any,
    settings: PrintSettings,
  ): Promise<void> {
    const html =
      typeof content === "string" ? content : JSON.stringify(content);
    return this.printReport({ html, name: "Document" }, settings);
  }

  /**
   * Print a label
   */
  private async printLabel(
    labelData: any,
    settings: PrintSettings,
  ): Promise<void> {
    const labelSettings = { ...settings, paperWidth: 100 };
    const html = this.generateLabelHTML(labelData);
    return this.printHTML(html, labelSettings);
  }

  /**
   * Generate HTML for a label
   */
  private generateLabelHTML(data: any): string {
    return `
      <div style="
        width: 100mm;
        padding: 10mm;
        font-family: Arial, sans-serif;
        font-size: 12px;
        border: 1px solid #000;
        page-break-inside: avoid;
      ">
        ${Object.entries(data)
          .map(([key, value]) => `<p><strong>${key}:</strong> ${value}</p>`)
          .join("")}
      </div>
    `;
  }

  /**
   * Start auto-processing timer
   */
  private startAutoProcessing(): void {
    this.processTimer = setInterval(() => {
      if (!this.isProcessing && this.queue.length > 0) {
        this.processPrintQueue();
      }
    }, 5000);
  }

  /**
   * Stop auto-processing
   */
  private stopAutoProcessing(): void {
    if (this.processTimer) {
      clearInterval(this.processTimer);
      this.processTimer = null;
    }
  }

  /**
   * Save queue to localStorage as fallback
   */
  private saveQueueToLocalStorage(): void {
    try {
      localStorage.setItem(QUEUE_KEY, JSON.stringify(this.queue));
    } catch (e) {
      console.error("Failed to save print queue to localStorage:", e);
    }
  }

  /**
   * Load queue from localStorage
   */
  private loadQueueFromLocalStorage(): void {
    try {
      const saved = localStorage.getItem(QUEUE_KEY);
      if (saved) {
        this.queue = JSON.parse(saved);
      }
    } catch (e) {
      console.error("Failed to load print queue from localStorage:", e);
    }
  }

  /**
   * Load queue from IndexedDB
   */
  private async loadQueue(): Promise<void> {
    try {
      const jobs = await this.dbStore.getAllJobs();
      const pendingJobs = jobs.filter(
        (j) => j.status === "pending" || j.status === "processing",
      );
      this.queue = pendingJobs;

      // Also check localStorage for any jobs not in IndexedDB
      this.loadQueueFromLocalStorage();
    } catch (e) {
      console.error("Failed to load print queue from IndexedDB:", e);
      this.loadQueueFromLocalStorage();
    }
  }

  /**
   * Add job to history
   */
  private async addToHistory(job: SilentPrintJob): Promise<void> {
    try {
      const historyKey = `fuelpro_print_history_${this.getStationId()}`;
      const history = JSON.parse(localStorage.getItem(historyKey) || "[]");
      history.unshift(job);
      // Keep only last 500 jobs
      if (history.length > 500) {
        history.splice(500);
      }
      localStorage.setItem(historyKey, JSON.stringify(history));
    } catch (e) {
      console.error("Failed to save print history:", e);
    }
  }

  /**
   * Get queue status
   */
  getQueueStatus(): {
    pending: number;
    processing: boolean;
    queue: SilentPrintJob[];
  } {
    return {
      pending: this.queue.length,
      processing: this.isProcessing,
      queue: [...this.queue],
    };
  }

  /**
   * Get full status for listeners
   */
  getStatus(): PrintServiceStatus {
    return {
      pending: this.queue.filter((j) => j.status === "pending").length,
      processing: this.isProcessing,
      isOnline: this.isOnline,
      queue: [...this.queue],
      history: this.getHistorySync(),
    };
  }

  /**
   * Get print history synchronously
   */
  private getHistorySync(): SilentPrintJob[] {
    try {
      const historyKey = `fuelpro_print_history_${this.getStationId()}`;
      return JSON.parse(localStorage.getItem(historyKey) || "[]");
    } catch {
      return [];
    }
  }

  /**
   * Get print history
   */
  async getHistory(limit: number = 50): Promise<SilentPrintJob[]> {
    try {
      const historyKey = `fuelpro_print_history_${this.getStationId()}`;
      const history = JSON.parse(localStorage.getItem(historyKey) || "[]");
      return Array.isArray(history) ? history.slice(0, limit) : [];
    } catch (e) {
      console.error("Failed to load print history:", e);
      return [];
    }
  }

  /**
   * Get failed jobs
   */
  async getFailedJobs(): Promise<SilentPrintJob[]> {
    return this.getHistory(100).then((history) =>
      history.filter((j) => j.status === "failed"),
    );
  }

  /**
   * Clear queue
   */
  async clearQueue(): Promise<void> {
    this.queue = [];
    this.saveQueueToLocalStorage();
    await this.dbStore.clear();
  }

  /**
   * Retry failed jobs
   */
  async retryFailed(): Promise<void> {
    const failed = await this.getFailedJobs();
    for (const job of failed) {
      job.retries = 0;
      job.status = "pending";
      job.error = undefined;
      this.queue.push(job);
      await this.dbStore.saveJob(job);
    }
    this.saveQueueToLocalStorage();
    this.processPrintQueue();
  }

  /**
   * Retry a specific job by ID
   */
  async retryJob(jobId: string): Promise<boolean> {
    const job = await this.dbStore.getJob(jobId);
    if (job && job.status === "failed") {
      job.retries = 0;
      job.status = "pending";
      job.error = undefined;
      this.queue.push(job);
      await this.dbStore.saveJob(job);
      this.saveQueueToLocalStorage();
      this.processPrintQueue();
      return true;
    }
    return false;
  }

  /**
   * Get station ID
   */
  private getStationId(): string {
    try {
      const station = JSON.parse(
        localStorage.getItem("fuelpro_station") || "{}",
      );
      return station.id || "default";
    } catch {
      return "default";
    }
  }

  /**
   * Get user ID
   */
  private getUserId(): string {
    try {
      const user = JSON.parse(localStorage.getItem("fuelpro_user") || "{}");
      return user.id || "anonymous";
    } catch {
      return "anonymous";
    }
  }

  /**
   * Cancel a pending job
   */
  async cancelJob(jobId: string): Promise<boolean> {
    const index = this.queue.findIndex((j) => j.id === jobId);
    if (index !== -1) {
      this.queue.splice(index, 1);
      this.saveQueueToLocalStorage();
      await this.dbStore.deleteJob(jobId);
      return true;
    }
    return false;
  }

  /**
   * Cleanup on destroy
   */
  destroy(): void {
    this.stopAutoProcessing();
    this.listeners.clear();
  }
}

export interface PrintServiceStatus {
  pending: number;
  processing: boolean;
  isOnline: boolean;
  queue: SilentPrintJob[];
  history: SilentPrintJob[];
}

export const silentPrintService = new SilentPrintService();
export default silentPrintService;
