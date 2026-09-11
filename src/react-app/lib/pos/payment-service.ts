// Card Payment Service - Handles payment terminal communication
import { hardwareManager, type CardReaderDevice } from "./hardware-manager";
import { EventEmitter } from "eventemitter3";
import { getCurrencySymbol } from "../currency";

// Import type-only to ensure USB types are available
import type {} from "./hardware-manager";

export interface CardData {
  cardNumber?: string;
  cardholderName?: string;
  expiryMonth?: string;
  expiryYear?: string;
  cardType?: "visa" | "mastercard" | "amex" | "discover" | "unknown";
  isEncrypted: boolean;
  rawData?: string;
}

export interface PaymentRequest {
  amount: number;
  currency: string;
  type: "sale" | "authorization" | "refund";
  reference?: string;
  description?: string;
}

export interface PaymentResponse {
  success: boolean;
  transactionId?: string;
  cardData?: CardData;
  authorizationCode?: string;
  errorCode?: string;
  errorMessage?: string;
  timestamp: Date;
}

export interface RefundRequest {
  originalTransactionId: string;
  amount: number;
  reason?: string;
}

class PaymentService extends EventEmitter {
  private isWaitingForCard = false;
  private cardResolve: ((card: CardData) => void) | null = null;
  private cardReject: ((error: Error) => void) | null = null;
  private pollInterval: number | null = null;
  private readonly POLL_INTERVAL = 100;

  constructor() {
    super();
    this.initCardReaderListeners();
  }

  private initCardReaderListeners(): void {
    hardwareManager.on("cardReaderConnected", (reader: CardReaderDevice) => {
      this.emit("readerConnected", reader);
      this.checkCardPresence(reader);
    });

    hardwareManager.on("cardReaderDisconnected", () => {
      this.emit("readerDisconnected");
      this.cancelWaitForCard();
    });
  }

  private async checkCardPresence(reader: CardReaderDevice): Promise<void> {
    if (reader.type === "usb" && reader.connection) {
      try {
        const device = reader.connection as USBDevice;
        // Poll for card insertion
        this.pollCardInsertion(device, reader);
      } catch (error) {
        console.error("Failed to check card presence:", error);
      }
    }
  }

  private async pollCardInsertion(
    device: USBDevice,
    reader: CardReaderDevice,
  ): Promise<void> {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
    }

    this.pollInterval = window.setInterval(async () => {
      if (this.isWaitingForCard && reader.status !== "waiting_for_card") {
        try {
          // Read card data from USB device
          const cardData = await this.readCardUSB(device, reader);
          if (cardData) {
            this.resolveCard(cardData);
          }
        } catch (error) {
          // Card not present or read error
        }
      }
    }, this.POLL_INTERVAL);
  }

  private async readCardUSB(
    device: USBDevice,
    reader: CardReaderDevice,
  ): Promise<CardData | null> {
    try {
      const endpointIn =
        device.configuration?.interfaces[0]?.alternates[0]?.endpoints.find(
          (e) => e.direction === "in",
        );
      if (!endpointIn) return null;

      const result = await device.transferIn(endpointIn.endpointNumber, 64);

      if (result.status === "ok" && result.data) {
        const data = new TextDecoder().decode(result.data);
        return this.parseCardData(data, reader);
      }
    } catch {
      // No data available
    }
    return null;
  }

  private parseCardData(data: string, reader: CardReaderDevice): CardData {
    // Handle different card reader formats
    const trackData = data.trim();

    // Parse Track 1 or Track 2 data
    if (trackData.startsWith("%B")) {
      // Track 1 format: %BXXXXXXXXXXXXXXXX^NAME^YYMMXXXXX?
      const parts = trackData.split("^");
      const cardNumber = parts[0]?.substring(2) || "";
      const cardholderName = parts[1] || "";
      const expiry = parts[2] || "";

      return {
        cardNumber: cardNumber.substring(0, 16),
        cardholderName,
        expiryMonth: expiry.substring(2, 4),
        expiryYear: expiry.substring(0, 2),
        cardType: this.detectCardType(cardNumber),
        isEncrypted: false,
        rawData: trackData,
      };
    } else if (trackData.startsWith(";")) {
      // Track 2 format: ;XXXXXXXXXXXXXXXX=YYMMXXXXX?
      const parts = trackData.split("=");
      const cardNumber = parts[0]?.substring(1) || "";
      const expiry = parts[1]?.substring(0, 4) || "";

      return {
        cardNumber: cardNumber,
        expiryMonth: expiry.substring(2, 4),
        expiryYear: expiry.substring(0, 2),
        cardType: this.detectCardType(cardNumber),
        isEncrypted: false,
        rawData: trackData,
      };
    }

    return {
      cardType: "unknown",
      isEncrypted: false,
      rawData: trackData,
    };
  }

  private detectCardType(cardNumber: string): CardData["cardType"] {
    const cleanNumber = cardNumber.replace(/\s/g, "");

    if (/^4/.test(cleanNumber)) return "visa";
    if (/^5[1-5]/.test(cleanNumber)) return "mastercard";
    if (/^3[47]/.test(cleanNumber)) return "amex";
    if (/^6(?:011|5)/.test(cleanNumber)) return "discover";

    return "unknown";
  }

  async waitForCardSwipe(timeout: number = 30000): Promise<CardData> {
    const reader = hardwareManager.getCardReader();

    if (!reader) {
      throw new Error(
        "No card reader connected. Please connect a card reader first.",
      );
    }

    if (this.isWaitingForCard) {
      throw new Error("Already waiting for card");
    }

    return new Promise<CardData>((resolve, reject) => {
      this.isWaitingForCard = true;
      this.cardResolve = resolve;
      this.cardReject = reject;
      reader.status = "waiting_for_card";
      this.emit("waitingForCard");

      // Set timeout
      setTimeout(() => {
        if (this.isWaitingForCard) {
          this.cancelWaitForCard();
          reject(new Error("Card swipe timeout"));
        }
      }, timeout);
    });
  }

  private resolveCard(card: CardData): void {
    if (this.cardResolve && this.isWaitingForCard) {
      const reader = hardwareManager.getCardReader();
      if (reader) {
        reader.status = "connected";
      }
      this.cardResolve(card);
      this.emit("cardReceived", card);
      this.cancelWaitForCard();
    }
  }

  cancelWaitForCard(): void {
    this.isWaitingForCard = false;
    this.cardResolve = null;
    this.cardReject = null;

    const reader = hardwareManager.getCardReader();
    if (reader) {
      reader.status = "connected";
    }

    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }

    this.emit("cardWaitCancelled");
  }

  async processPayment(request: PaymentRequest): Promise<PaymentResponse> {
    try {
      // Step 1: Wait for card
      this.emit("waitingForCard");
      const cardData = await this.waitForCardSwipe();

      // Step 2: Mask card number for display
      const maskedCard = this.maskCardNumber(cardData.cardNumber || "");

      // Step 3: Send to backend for processing
      this.emit("processing", { maskedCard });

      const response = await fetch("/api/payments/process", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          cardData: cardData.rawData,
          amount: request.amount,
          currency: request.currency,
          type: request.type,
          reference: request.reference,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Payment failed");
      }

      const result = await response.json();

      this.emit("paymentComplete", result);

      return {
        success: true,
        transactionId: result.transactionId,
        cardData,
        authorizationCode: result.authorizationCode,
        timestamp: new Date(),
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";

      this.emit("paymentError", { error: errorMessage });

      return {
        success: false,
        errorCode: "PAYMENT_FAILED",
        errorMessage,
        timestamp: new Date(),
      };
    } finally {
      this.cancelWaitForCard();
    }
  }

  async processRefund(request: RefundRequest): Promise<PaymentResponse> {
    try {
      const response = await fetch("/api/payments/refund", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(request),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Refund failed");
      }

      const result = await response.json();

      return {
        success: true,
        transactionId: result.transactionId,
        timestamp: new Date(),
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";

      return {
        success: false,
        errorCode: "REFUND_FAILED",
        errorMessage,
        timestamp: new Date(),
      };
    }
  }

  private maskCardNumber(cardNumber: string): string {
    if (!cardNumber || cardNumber.length < 4) {
      return "****";
    }
    const last4 = cardNumber.slice(-4);
    return `**** **** **** ${last4}`;
  }

  // Simulate payment for testing without real card reader
  async simulateCardPayment(
    amount: number,
    currency: string = getCurrencySymbol(),
  ): Promise<PaymentResponse> {
    return new Promise((resolve) => {
      this.emit("simulating", { amount });

      setTimeout(() => {
        const success = Math.random() > 0.1; // 90% success rate for simulation

        if (success) {
          this.emit("paymentComplete", { transactionId: `SIM-${Date.now()}` });
          resolve({
            success: true,
            transactionId: `SIM-${Date.now()}`,
            cardData: {
              cardNumber: "4111111111111111",
              cardholderName: "TEST USER",
              expiryMonth: "12",
              expiryYear: "28",
              cardType: "visa",
              isEncrypted: false,
            },
            authorizationCode: "AUTH123",
            timestamp: new Date(),
          });
        } else {
          resolve({
            success: false,
            errorCode: "CARD_DECLINED",
            errorMessage: "Card was declined by issuer",
            timestamp: new Date(),
          });
        }
      }, 2000);
    });
  }

  getReaderStatus(): { connected: boolean; status: string } {
    const reader = hardwareManager.getCardReader();
    return {
      connected: !!reader,
      status: reader?.status || "disconnected",
    };
  }
}

export const paymentService = new PaymentService();
export default paymentService;
