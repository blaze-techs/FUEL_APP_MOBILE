// POS Hardware Manager - Handles USB/Bluetooth device detection and management
import { EventEmitter } from "eventemitter3";

// Augment global types for USB Web API if not already defined
declare global {
  interface USBDevice {
    vendorId: number;
    productId: number;
    productName: string;
    manufacturerName?: string;
    opened: boolean;
    configuration?: USBConfiguration;
    open(): Promise<void>;
    close(): Promise<void>;
    selectConfiguration(configurationValue: number): Promise<void>;
    claimInterface(interfaceNumber: number): Promise<void>;
    releaseInterface(interfaceNumber: number): Promise<void>;
    transferIn(
      endpointNumber: number,
      length: number,
    ): Promise<USBInTransferResult>;
    transferOut(
      endpointNumber: number,
      data: BufferSource,
    ): Promise<USBOutTransferResult>;
  }

  interface USBConfiguration {
    configurationValue: number;
    configurationName?: string;
    interfaces: USBInterface[];
  }

  interface USBInterface {
    interfaceNumber: number;
    alternate: USBAlternateInterface;
    alternates: USBAlternateInterface[];
    claimed: boolean;
  }

  interface USBAlternateInterface {
    alternateSetting: number;
    interfaceClass: number;
    interfaceSubclass: number;
    interfaceProtocol: number;
    interfaceName?: string;
    endpoints: USBEndpoint[];
  }

  interface USBEndpoint {
    endpointNumber: number;
    direction: "in" | "out";
    type: "bulk" | "interrupt" | "isochronous";
    packetSize: number;
  }

  interface USBInTransferResult {
    data?: DataView;
    status: USBTransferStatus;
  }

  interface USBOutTransferResult {
    bytesWritten: number;
    status: USBTransferStatus;
  }

  type USBTransferStatus = "ok" | "stall" | "babble";

  interface BluetoothDevice {
    uuid: string;
    name?: string;
  }
}

export interface PrinterDevice {
  id: string;
  name: string;
  type: "usb" | "bluetooth" | "network";
  vendorId?: number;
  productId?: number;
  connection?: USBDevice | BluetoothDevice;
  status: "connected" | "disconnected" | "error";
  capabilities: string[];
}

export interface CardReaderDevice {
  id: string;
  name: string;
  type: "usb" | "bluetooth";
  vendorId?: number;
  productId?: number;
  connection?: USBDevice | BluetoothDevice;
  status: "connected" | "disconnected" | "error" | "waiting_for_card";
  supportedMethods: ("swipe" | "chip" | "contactless")[];
}

export interface CashDrawerDevice {
  id: string;
  name: string;
  type: "printer_connected" | "usb" | "bluetooth";
  status: "connected" | "disconnected" | "error";
  connectedPrinter?: string;
}

export interface BarcodeScannerDevice {
  id: string;
  name: string;
  type: "usb" | "bluetooth" | "keyboard";
  status: "connected" | "disconnected";
  onScan?: (barcode: string) => void;
}

export interface CustomerDisplayDevice {
  id: string;
  name: string;
  type: "usb" | "network" | "bluetooth";
  connection?: USBDevice | BluetoothDevice;
  status: "connected" | "disconnected" | "error";
}

class HardwareManager extends EventEmitter {
  private printers: Map<string, PrinterDevice> = new Map();
  private cardReaders: Map<string, CardReaderDevice> = new Map();
  private cashDrawers: Map<string, CashDrawerDevice> = new Map();
  private barcodeScanners: Map<string, BarcodeScannerDevice> = new Map();
  private customerDisplays: Map<string, CustomerDisplayDevice> = new Map();
  private networkPrinters: Map<string, PrinterDevice> = new Map();
  private isScanning = false;
  private scanInterval: number | null = null;

  constructor() {
    super();
    this.initUSBListeners();
    this.initBluetoothListeners();
    this.initKeyboardScanner();
  }

  private initUSBListeners(): void {
    if ("usb" in navigator) {
      (navigator as any).usb.addEventListener("connect", (event: any) => {
        this.handleUSBConnect(event.device);
      });
      (navigator as any).usb.addEventListener("disconnect", (event: any) => {
        this.handleUSBDisconnect(event.device);
      });
    }
  }

  private initBluetoothListeners(): void {
    if ("bluetooth" in navigator) {
      // Bluetooth device handling
    }
  }

  private initKeyboardScanner(): void {
    // Keyboard wedge scanners send data rapidly followed by Enter
    let buffer = "";
    let bufferTimeout: number | null = null;

    document.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && buffer.length > 0) {
        this.barcodeScanners.forEach((scanner) => {
          if (scanner.onScan && scanner.status === "connected") {
            scanner.onScan(buffer);
          }
        });
        buffer = "";
      } else if (
        event.key.length === 1 &&
        !event.ctrlKey &&
        !event.altKey &&
        !event.metaKey
      ) {
        buffer += event.key;
        if (bufferTimeout) clearTimeout(bufferTimeout);
        bufferTimeout = window.setTimeout(() => {
          buffer = "";
        }, 100);
      }
    });
  }

  private async handleUSBConnect(device: USBDevice): Promise<void> {
    const deviceInfo = this.identifyUSBDevice(device);

    switch (deviceInfo.type) {
      case "printer": {
        const printer: PrinterDevice = {
          id: `usb-${device.vendorId}-${device.productId}`,
          name: device.productName || "USB Printer",
          type: "usb",
          vendorId: device.vendorId,
          productId: device.productId,
          connection: device,
          status: "connected",
          capabilities: deviceInfo.capabilities || ["print", "cut"],
        };
        this.printers.set(printer.id, printer);
        this.emit("printerConnected", printer);
        break;
      }

      case "cardReader": {
        const cardReader: CardReaderDevice = {
          id: `usb-${device.vendorId}-${device.productId}`,
          name: device.productName || "Card Reader",
          type: "usb",
          vendorId: device.vendorId,
          productId: device.productId,
          connection: device,
          status: "connected",
          supportedMethods: ["swipe", "chip", "contactless"],
        };
        this.cardReaders.set(cardReader.id, cardReader);
        this.emit("cardReaderConnected", cardReader);
        break;
      }

      case "cashDrawer": {
        const cashDrawer: CashDrawerDevice = {
          id: `usb-${device.vendorId}-${device.productId}`,
          name: device.productName || "Cash Drawer",
          type: "usb",
          status: "connected",
        };
        this.cashDrawers.set(cashDrawer.id, cashDrawer);
        this.emit("cashDrawerConnected", cashDrawer);
        break;
      }
    }
  }

  private handleUSBDisconnect(device: USBDevice): void {
    const deviceId = `usb-${device.vendorId}-${device.productId}`;

    if (this.printers.has(deviceId)) {
      this.printers.delete(deviceId);
      this.emit("printerDisconnected", { id: deviceId });
    }
    if (this.cardReaders.has(deviceId)) {
      this.cardReaders.delete(deviceId);
      this.emit("cardReaderDisconnected", { id: deviceId });
    }
    if (this.cashDrawers.has(deviceId)) {
      this.cashDrawers.delete(deviceId);
      this.emit("cashDrawerDisconnected", { id: deviceId });
    }
  }

  private identifyUSBDevice(device: USBDevice): {
    type: string;
    capabilities?: string[];
  } {
    // Common USB printer vendor IDs
    const printerVendors = [
      0x04b8, 0x0416, 0x04a9, 0x0519, 0x0471, 0x0dd4, 0x0dd5,
    ];
    const cardReaderVendors = [0x076b, 0x0dd0, 0x0c15, 0x0b57];

    if (printerVendors.includes(device.vendorId)) {
      return { type: "printer", capabilities: ["print", "cut", "cashDrawer"] };
    }
    if (cardReaderVendors.includes(device.vendorId)) {
      return { type: "cardReader" };
    }

    return { type: "unknown" };
  }

  async scanUSBDevices(): Promise<void> {
    if (!("usb" in navigator)) {
      console.warn("WebUSB not supported");
      return;
    }

    try {
      const device = await (navigator as any).usb.requestDevice({
        filters: [
          { vendorId: 0x04b8 }, // Epson
          { vendorId: 0x0416 }, // Winbond/NPC
          { vendorId: 0x04a9 }, // Canon
          { vendorId: 0x076b }, // MagTek
          { vendorId: 0x0c15 }, // MagTek
        ],
      });

      await device.open();
      await device.selectConfiguration(1);
      await device.claimInterface(0);

      await this.handleUSBConnect(device);
    } catch (error) {
      console.error("USB device scan failed:", error);
      this.emit("scanError", error);
    }
  }

  async scanBluetoothDevices(): Promise<void> {
    if (!("bluetooth" in navigator)) {
      console.warn("Web Bluetooth not supported");
      return;
    }

    try {
      const device = await (navigator as any).bluetooth.requestDevice({
        filters: [
          { namePrefix: "Printer" },
          { namePrefix: "TSP" },
          { namePrefix: "POS" },
          { namePrefix: "Card" },
        ],
        optionalServices: ["00001101-0000-1000-8000-00805f9b34fb"], // Serial port
      });

      this.emit("bluetoothDeviceFound", device);
    } catch (error) {
      console.error("Bluetooth scan failed:", error);
      this.emit("scanError", error);
    }
  }

  async addNetworkPrinter(
    ip: string,
    port: number = 9100,
  ): Promise<PrinterDevice> {
    const printer: PrinterDevice = {
      id: `network-${ip}-${port}`,
      name: `Network Printer (${ip})`,
      type: "network",
      status: "connected",
      capabilities: ["print", "cut"],
    };

    this.networkPrinters.set(printer.id, printer);
    this.printers.set(printer.id, printer);
    this.emit("printerConnected", printer);

    return printer;
  }

  getAllPrinters(): PrinterDevice[] {
    return Array.from(this.printers.values());
  }

  getPrinter(id?: string): PrinterDevice | undefined {
    if (id) {
      return this.printers.get(id);
    }
    return this.printers.values().next().value;
  }

  getCardReader(id?: string): CardReaderDevice | undefined {
    if (id) {
      return this.cardReaders.get(id);
    }
    return this.cardReaders.values().next().value;
  }

  getCashDrawer(id?: string): CashDrawerDevice | undefined {
    if (id) {
      return this.cashDrawers.get(id);
    }
    return this.cashDrawers.values().next().value;
  }

  getAllCardReaders(): CardReaderDevice[] {
    return Array.from(this.cardReaders.values());
  }

  getAllCashDrawers(): CashDrawerDevice[] {
    return Array.from(this.cashDrawers.values());
  }

  getAllBarcodeScanners(): BarcodeScannerDevice[] {
    return Array.from(this.barcodeScanners.values());
  }

  registerBarcodeScanner(scanner: BarcodeScannerDevice): void {
    this.barcodeScanners.set(scanner.id, scanner);
    this.emit("barcodeScannerConnected", scanner);
  }

  unregisterBarcodeScanner(id: string): void {
    this.barcodeScanners.delete(id);
    this.emit("barcodeScannerDisconnected", { id });
  }

  getCustomerDisplay(id?: string): CustomerDisplayDevice | undefined {
    if (id) {
      return this.customerDisplays.get(id);
    }
    return this.customerDisplays.values().next().value;
  }

  async disconnectDevice(id: string, type: string): Promise<void> {
    // Helper to check if connection has USB-like methods
    const isUSBConnection = (
      conn: USBDevice | BluetoothDevice | undefined,
    ): conn is USBDevice => {
      return conn !== undefined && "vendorId" in conn && "transferIn" in conn;
    };

    switch (type) {
      case "printer": {
        const printer = this.printers.get(id);
        if (isUSBConnection(printer?.connection)) {
          await printer.connection.close();
        }
        this.printers.delete(id);
        this.emit("printerDisconnected", { id });
        break;
      }

      case "cardReader": {
        const reader = this.cardReaders.get(id);
        if (isUSBConnection(reader?.connection)) {
          await reader.connection.close();
        }
        this.cardReaders.delete(id);
        this.emit("cardReaderDisconnected", { id });
        break;
      }
    }
  }

  disconnectAll(): void {
    this.printers.forEach((_, id) => {
      this.disconnectDevice(id, "printer");
    });
    this.cardReaders.forEach((_, id) => {
      this.disconnectDevice(id, "cardReader");
    });
    this.emit("allDisconnected");
  }

  getDeviceStatus(): {
    printers: number;
    cardReaders: number;
    cashDrawers: number;
    barcodeScanners: number;
    customerDisplays: number;
  } {
    return {
      printers: this.printers.size,
      cardReaders: this.cardReaders.size,
      cashDrawers: this.cashDrawers.size,
      barcodeScanners: this.barcodeScanners.size,
      customerDisplays: this.customerDisplays.size,
    };
  }
}

export const hardwareManager = new HardwareManager();
export default hardwareManager;
