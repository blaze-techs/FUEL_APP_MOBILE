// POS Library - Hardware and Payment Integration
export {
  hardwareManager,
  type PrinterDevice,
  type CardReaderDevice,
  type CashDrawerDevice,
  type BarcodeScannerDevice,
  type CustomerDisplayDevice,
} from "./hardware-manager";
export {
  printerService,
  type ReceiptData,
  type ReceiptItem,
  type PrintJob,
} from "./printer-service";
export {
  paymentService,
  type CardData,
  type PaymentRequest,
  type PaymentResponse,
  type RefundRequest,
} from "./payment-service";
