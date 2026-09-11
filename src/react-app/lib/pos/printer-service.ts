// ESC/POS Printer Service - Handles thermal printer communication
import { hardwareManager, type PrinterDevice } from "./hardware-manager";
import { getCurrencySymbol } from "@/react-app/lib/currency";

// Import type-only to ensure USB types are available
import type {} from "./hardware-manager";

export interface ReceiptData {
  stationName: string;
  stationLocation: string;
  stationPhone?: string;
  stationEmail?: string;
  logoUrl?: string;
  receiptNumber: string;
  date: string;
  time: string;
  items: ReceiptItem[];
  subtotal: number;
  tax: number;
  discount: number;
  total: number;
  paymentMethod: string;
  amountPaid: number;
  change: number;
  customerName?: string;
  attendantName: string;
  transactionRef?: string;
  footerMessage?: string;
  currencyCode?: string; // Currency code (KES, UGX, etc.)
  currencySymbol?: string; // Currency symbol (KSh, USh, etc.)
  settings?: { paperWidth?: number; copies?: number; silent?: boolean };
}

// Helper to get currency info for receipts
export function getReceiptCurrency(currencyCode?: string): {
  code: string;
  symbol: string;
} {
  const code = currencyCode || getDetectedCurrencyForReceipt();
  const symbol = getCurrencySymbol(code);
  return { code, symbol };
}

// Get detected currency for receipt (used when not specified)
function getDetectedCurrencyForReceipt(): string {
  try {
    // Try to get from station context
    const stationCurrency = localStorage.getItem("fuelpro_station_currency");
    if (stationCurrency) return stationCurrency;

    // Try to get from location context
    const location = localStorage.getItem("fuelpro_location_country");
    if (location) {
      const parsed = JSON.parse(location);
      if (parsed.currency) return parsed.currency;
    }
  } catch {}

  // Fallback to detected currency
  return getCurrencySymbol();
}

export interface ReceiptItem {
  name: string;
  quantity: number;
  unitPrice: number;
  total: number;
}

export interface PrintJob {
  id: string;
  status: "pending" | "printing" | "completed" | "error";
  data: Uint8Array;
  printerId: string;
  retries: number;
  createdAt: Date;
  completedAt?: Date;
  error?: string;
}

class PrinterService {
  private printQueue: PrintJob[] = [];
  private isProcessing = false;
  private currentJob: PrintJob | null = null;
  private maxRetries = 3;

  // ESC/POS Commands
  private readonly ESC = 0x1b;
  private readonly GS = 0x1d;
  private readonly LF = 0x0a;

  // ESC/POS command builders
  private cmdInit(): Uint8Array {
    return new Uint8Array([this.ESC, 0x40]); // Initialize printer
  }

  private cmdAlign(align: "left" | "center" | "right"): Uint8Array {
    const alignCode = align === "left" ? 0 : align === "center" ? 1 : 2;
    return new Uint8Array([this.ESC, 0x61, alignCode]);
  }

  private cmdBold(on: boolean): Uint8Array {
    return new Uint8Array([this.ESC, 0x45, on ? 1 : 0]);
  }

  private cmdDoubleHeight(on: boolean): Uint8Array {
    return new Uint8Array([this.ESC, 0x21, on ? 0x10 : 0]);
  }

  private cmdDoubleWidth(on: boolean): Uint8Array {
    return new Uint8Array([this.ESC, 0x21, on ? 0x20 : 0]);
  }

  private cmdUnderline(on: boolean): Uint8Array {
    return new Uint8Array([this.ESC, 0x2d, on ? 1 : 0]);
  }

  private cmdFontSize(size: 0 | 1 | 2 | 3): Uint8Array {
    return new Uint8Array([this.GS, 0x21, size]);
  }

  private cmdCut(): Uint8Array {
    return new Uint8Array([this.GS, 0x56, 0x00]); // Full cut
  }

  private cmdPartialCut(): Uint8Array {
    return new Uint8Array([this.GS, 0x56, 0x01]); // Partial cut
  }

  private cmdFeed(lines: number): Uint8Array {
    return new Uint8Array([this.ESC, 0x64, lines]);
  }

  private cmdOpenCashDrawer(): Uint8Array {
    return new Uint8Array([this.ESC, 0x70, 0x00, 0x19, 0xfa]); // Standard drawer kick
  }

  private cmdBeep(): Uint8Array {
    return new Uint8Array([this.ESC, 0x42, 0x05, 0x09]); // Beep
  }

  private textToBytes(text: string): Uint8Array {
    const encoder = new TextEncoder();
    return encoder.encode(text);
  }

  private newline(): Uint8Array {
    return new Uint8Array([this.LF]);
  }

  private combineBytes(...arrays: Uint8Array[]): Uint8Array {
    const totalLength = arrays.reduce((sum, arr) => sum + arr.length, 0);
    const result = new Uint8Array(totalLength);
    let offset = 0;
    for (const arr of arrays) {
      result.set(arr, offset);
      offset += arr.length;
    }
    return result;
  }

  private formatCurrency(amount: number): string {
    // Use the browser default locale (undefined) so the receipt formats
    // amounts per the station/user locale instead of the hardcoded "en-KE".
    return `${getCurrencySymbol()} ${amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  private formatLine(left: string, right: string, width: number = 42): string {
    const padding = width - left.length - right.length;
    if (padding < 1) {
      return left.slice(0, width - right.length - 1) + " " + right;
    }
    return left + " ".repeat(padding) + right;
  }

  buildReceipt(receipt: ReceiptData): Uint8Array {
    const commands: Uint8Array[] = [];

    // Initialize
    commands.push(this.cmdInit());

    // Header - Station Info
    commands.push(this.cmdAlign("center"));
    commands.push(this.cmdBold(true));
    commands.push(this.cmdDoubleHeight(true));
    commands.push(this.textToBytes(receipt.stationName));
    commands.push(this.newline());

    commands.push(this.cmdDoubleHeight(false));
    commands.push(this.cmdBold(false));
    commands.push(this.textToBytes(receipt.stationLocation));
    commands.push(this.newline());
    if (receipt.stationPhone) {
      commands.push(this.textToBytes(`Tel: ${receipt.stationPhone}`));
      commands.push(this.newline());
    }
    if (receipt.stationEmail) {
      commands.push(this.textToBytes(`Email: ${receipt.stationEmail}`));
      commands.push(this.newline());
    }

    // Divider
    commands.push(this.textToBytes("========================================"));
    commands.push(this.newline());

    // Receipt Info
    commands.push(this.cmdAlign("left"));
    commands.push(
      this.textToBytes(this.formatLine("Receipt #:", receipt.receiptNumber)),
    );
    commands.push(this.newline());
    commands.push(this.textToBytes(this.formatLine("Date:", receipt.date)));
    commands.push(this.newline());
    commands.push(this.textToBytes(this.formatLine("Time:", receipt.time)));
    commands.push(this.newline());

    if (receipt.transactionRef) {
      commands.push(
        this.textToBytes(this.formatLine("Ref:", receipt.transactionRef)),
      );
      commands.push(this.newline());
    }

    // Customer
    if (receipt.customerName) {
      commands.push(
        this.textToBytes(this.formatLine("Customer:", receipt.customerName)),
      );
      commands.push(this.newline());
    }

    commands.push(
      this.textToBytes(this.formatLine("Attendant:", receipt.attendantName)),
    );
    commands.push(this.newline());

    // Divider
    commands.push(this.textToBytes("----------------------------------------"));
    commands.push(this.newline());

    // Items Header
    commands.push(this.cmdBold(true));
    commands.push(this.textToBytes(this.formatLine("ITEM", "TOTAL")));
    commands.push(this.newline());
    commands.push(this.cmdBold(false));
    commands.push(this.textToBytes("----------------------------------------"));
    commands.push(this.newline());

    // Items
    for (const item of receipt.items) {
      const itemLine = `${item.name} x${item.quantity}`;
      const priceLine = this.formatCurrency(item.total);
      commands.push(this.textToBytes(this.formatLine(itemLine, priceLine)));
      commands.push(this.newline());
    }

    // Divider
    commands.push(this.textToBytes("----------------------------------------"));
    commands.push(this.newline());

    // Totals
    commands.push(
      this.textToBytes(
        this.formatLine("Subtotal:", this.formatCurrency(receipt.subtotal)),
      ),
    );
    commands.push(this.newline());

    if (receipt.discount > 0) {
      commands.push(
        this.textToBytes(
          this.formatLine(
            "Discount:",
            "-" + this.formatCurrency(receipt.discount),
          ),
        ),
      );
      commands.push(this.newline());
    }

    if (receipt.tax > 0) {
      commands.push(
        this.textToBytes(
          this.formatLine("Tax (VAT):", this.formatCurrency(receipt.tax)),
        ),
      );
      commands.push(this.newline());
    }

    commands.push(this.cmdBold(true));
    commands.push(this.cmdDoubleHeight(true));
    commands.push(
      this.textToBytes(
        this.formatLine("TOTAL:", this.formatCurrency(receipt.total)),
      ),
    );
    commands.push(this.newline());
    commands.push(this.cmdDoubleHeight(false));
    commands.push(this.cmdBold(false));

    // Payment Info
    commands.push(this.newline());
    commands.push(this.textToBytes("----------------------------------------"));
    commands.push(this.newline());

    commands.push(
      this.textToBytes(
        this.formatLine("Payment:", receipt.paymentMethod.toUpperCase()),
      ),
    );
    commands.push(this.newline());
    commands.push(
      this.textToBytes(
        this.formatLine("Paid:", this.formatCurrency(receipt.amountPaid)),
      ),
    );
    commands.push(this.newline());

    if (receipt.change > 0) {
      commands.push(this.cmdBold(true));
      commands.push(
        this.textToBytes(
          this.formatLine("CHANGE:", this.formatCurrency(receipt.change)),
        ),
      );
      commands.push(this.newline());
      commands.push(this.cmdBold(false));
    }

    // Footer
    commands.push(this.newline());
    commands.push(this.cmdAlign("center"));
    commands.push(this.textToBytes("----------------------------------------"));
    commands.push(this.newline());

    commands.push(this.textToBytes("Thank you for your business!"));
    commands.push(this.newline());
    commands.push(this.textToBytes("Please come again"));
    commands.push(this.newline());

    if (receipt.footerMessage) {
      commands.push(this.textToBytes(receipt.footerMessage));
      commands.push(this.newline());
    }

    commands.push(this.newline());
    commands.push(this.newline());

    // Cut paper
    commands.push(this.cmdCut());

    return this.combineBytes(...commands);
  }

  async printReceipt(
    receipt: ReceiptData,
    printerId?: string,
  ): Promise<boolean> {
    const printer = printerId
      ? hardwareManager.getPrinter(printerId)
      : hardwareManager.getPrinter();

    if (!printer) {
      throw new Error("No printer connected");
    }

    const data = this.buildReceipt(receipt);
    const job: PrintJob = {
      id: `job-${Date.now()}`,
      status: "pending",
      data,
      printerId: printer.id,
      retries: 0,
      createdAt: new Date(),
    };

    this.printQueue.push(job);
    return this.processPrintQueue();
  }

  async printText(
    text: string,
    options?: {
      cut?: boolean;
      bold?: boolean;
      align?: "left" | "center" | "right";
    },
  ): Promise<boolean> {
    const printer = hardwareManager.getPrinter();
    if (!printer) {
      throw new Error("No printer connected");
    }

    const commands: Uint8Array[] = [this.cmdInit()];

    if (options?.bold) commands.push(this.cmdBold(true));
    if (options?.align) commands.push(this.cmdAlign(options.align));

    commands.push(this.textToBytes(text));
    commands.push(this.newline());

    if (options?.cut) {
      commands.push(this.cmdFeed(3));
      commands.push(this.cmdCut());
    }

    const data = this.combineBytes(...commands);
    const job: PrintJob = {
      id: `job-${Date.now()}`,
      status: "pending",
      data,
      printerId: printer.id,
      retries: 0,
      createdAt: new Date(),
    };

    this.printQueue.push(job);
    return this.processPrintQueue();
  }

  async printBarcode(
    data: string,
    type: "ean13" | "ean8" | "upc" | "code39" | "code128" = "code128",
  ): Promise<boolean> {
    const printer = hardwareManager.getPrinter();
    if (!printer) {
      throw new Error("No printer connected");
    }

    // ESC/POS barcode commands simplified
    const commands: Uint8Array[] = [
      this.cmdInit(),
      this.textToBytes(data),
      this.newline(),
      this.cmdCut(),
    ];

    const job: PrintJob = {
      id: `job-${Date.now()}`,
      status: "pending",
      data: this.combineBytes(...commands),
      printerId: printer.id,
      retries: 0,
      createdAt: new Date(),
    };

    this.printQueue.push(job);
    return this.processPrintQueue();
  }

  async testPrint(printerId?: string): Promise<boolean> {
    const printer = printerId
      ? hardwareManager.getPrinter(printerId)
      : hardwareManager.getPrinter();

    if (!printer) {
      throw new Error("No printer connected");
    }

    const commands: Uint8Array[] = [
      this.cmdInit(),
      this.cmdAlign("center"),
      this.cmdBold(true),
      this.cmdDoubleHeight(true),
      this.cmdFontSize(2),
      this.textToBytes("FUELPRO"),
      this.newline(),
      this.cmdDoubleHeight(false),
      this.cmdFontSize(0),
      this.textToBytes("TEST PRINT"),
      this.newline(),
      this.newline(),
      this.cmdBold(false),
      this.textToBytes("Printer: " + printer.name),
      this.newline(),
      this.textToBytes("Status: OK"),
      this.newline(),
      this.textToBytes("Date: " + new Date().toLocaleString()),
      this.newline(),
      this.newline(),
      this.newline(),
      this.cmdCut(),
    ];

    const job: PrintJob = {
      id: `job-test-${Date.now()}`,
      status: "pending",
      data: this.combineBytes(...commands),
      printerId: printer.id,
      retries: 0,
      createdAt: new Date(),
    };

    this.printQueue.push(job);
    return this.processPrintQueue();
  }

  async openCashDrawer(printerId?: string): Promise<boolean> {
    const printer = printerId
      ? hardwareManager.getPrinter(printerId)
      : hardwareManager.getPrinter();

    if (!printer) {
      throw new Error("No printer connected");
    }

    if (printer.type === "network") {
      return this.openCashDrawerNetwork(printer);
    } else if (printer.type === "usb" && printer.connection) {
      return this.openCashDrawerUSB(printer);
    }

    return false;
  }

  private async openCashDrawerNetwork(
    printer: PrinterDevice,
  ): Promise<boolean> {
    try {
      const match = printer.name.match(/\((\d+\.\d+\.\d+\.\d+)\)/);
      if (!match) return false;

      const ip = match[1];
      const command = this.cmdOpenCashDrawer();
      const response = await fetch(`http://${ip}:9100`, {
        method: "POST",
        body: command as BodyInit,
        mode: "no-cors",
      });
      return true;
    } catch (error) {
      console.error("Failed to open cash drawer:", error);
      return false;
    }
  }

  private async openCashDrawerUSB(printer: PrinterDevice): Promise<boolean> {
    try {
      const device = printer.connection as USBDevice;
      const endpointOut =
        device.configuration?.interfaces[0]?.alternates[0]?.endpoints.find(
          (e) => e.direction === "out",
        );

      if (!endpointOut) return false;

      const command = this.cmdOpenCashDrawer();
      await device.transferOut(
        endpointOut.endpointNumber,
        command as BufferSource,
      );
      return true;
    } catch (error) {
      console.error("Failed to open cash drawer:", error);
      return false;
    }
  }

  private async processPrintQueue(): Promise<boolean> {
    if (this.isProcessing || this.printQueue.length === 0) {
      return this.printQueue.length === 0;
    }

    this.isProcessing = true;
    const job = this.printQueue.shift()!;
    this.currentJob = job;
    job.status = "printing";

    try {
      const printer = hardwareManager.getPrinter(job.printerId);
      if (!printer) {
        throw new Error("Printer not found");
      }

      if (printer.type === "network") {
        await this.printNetwork(job);
      } else if (printer.type === "usb" && printer.connection) {
        await this.printUSB(job);
      } else {
        // Fallback: Open in new window for manual printing
        this.printFallback(job);
      }

      job.status = "completed";
      job.completedAt = new Date();
    } catch (error) {
      job.retries++;
      if (job.retries < this.maxRetries) {
        this.printQueue.unshift(job);
      } else {
        job.status = "error";
        job.error = error instanceof Error ? error.message : "Unknown error";
      }
    } finally {
      this.isProcessing = false;
      this.currentJob = null;
      if (this.printQueue.length > 0) {
        this.processPrintQueue();
      }
    }

    return job.status === "completed";
  }

  private async printNetwork(job: PrintJob): Promise<void> {
    const printer = hardwareManager.getPrinter(job.printerId);
    if (!printer) return;

    const match = printer.name.match(/\((\d+\.\d+\.\d+\.\d+)\)/);
    if (!match) throw new Error("Invalid network printer address");

    const ip = match[1];
    const response = await fetch(`http://${ip}:9100`, {
      method: "POST",
      body: job.data as BodyInit,
      mode: "no-cors",
    });

    if (!response.ok && response.status !== 0) {
      throw new Error(`Print failed: ${response.status}`);
    }
  }

  private async printUSB(job: PrintJob): Promise<void> {
    const printer = hardwareManager.getPrinter(job.printerId);
    if (!printer?.connection) return;

    const device = printer.connection as USBDevice;
    const endpointOut =
      device.configuration?.interfaces[0]?.alternates[0]?.endpoints.find(
        (e) => e.direction === "out",
      );

    if (!endpointOut) {
      throw new Error("No output endpoint found");
    }

    await device.transferOut(
      endpointOut.endpointNumber,
      job.data as BufferSource,
    );
  }

  private printFallback(job: PrintJob): void {
    // Create printable HTML version
    const text = new TextDecoder().decode(job.data);
    const printWindow = window.open("", "_blank");
    if (printWindow) {
      // The receipt text is inserted via textContent (not interpolated into
      // the HTML string) so receipt content can never inject markup/script.
      const rootDark =
        typeof document !== "undefined" &&
        document.documentElement.classList.contains("dark");
      printWindow.document.write(`
        <html class="${rootDark ? "fp-dark" : ""}">
          <head><title>Print</title>
          <style>
            :root{--fp-bg:#0a0e17;--fp-card:#111625;--fp-border:#252c3f;--fp-text:#e7ebf1;}
            html.fp-dark,html.fp-dark body{background:var(--fp-bg);color:var(--fp-text);}
            html.fp-dark pre{color:var(--fp-text);}
            @media print{html.fp-dark,html.fp-dark body,html.fp-dark pre{background:#fff;color:#000;}}
          </style>
          </head>
          <body>
            <pre id="content" style="font-family: monospace; white-space: pre-wrap;"></pre>
            <script>window.print(); window.close();</script>
          </body>
        </html>
      `);
      const preElement = printWindow.document.getElementById("content");
      if (preElement) {
        preElement.textContent = text;
      }
      printWindow.document.close();
    }
  }

  getQueueStatus(): { pending: number; printing: boolean; current?: PrintJob } {
    return {
      pending: this.printQueue.length,
      printing: this.isProcessing,
      current: this.currentJob || undefined,
    };
  }

  clearQueue(): void {
    this.printQueue = [];
  }
}

export const printerService = new PrinterService();
export default printerService;
