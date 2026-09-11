# FuelPro Open-Source Integrations

## Overview

This document describes the open-source integrations added to the FuelPro application. These integrations enhance the application with analytics, payments, notifications, AI capabilities, and offline support.

## New Integrations Added

### 1. Analytics & Monitoring

| Integration   | Description                              | GitHub                                                          |
| ------------- | ---------------------------------------- | --------------------------------------------------------------- |
| **PostHog**   | Product analytics with session recording | [posthog/posthog](https://github.com/posthog/posthog)           |
| **Umami**     | Privacy-focused web analytics            | [umami-software/umami](https://github.com/umami-software/umami) |
| **GlitchTip** | Error tracking (Sentry alternative)      | [glitchtip/glitchtip](https://github.com/glitchtip/glitchtip)   |

### 2. Customer Communication

| Integration  | Description                    | GitHub                                                    |
| ------------ | ------------------------------ | --------------------------------------------------------- |
| **Chatwoot** | Live chat and customer support | [chatwoot/chatwoot](https://github.com/chatwoot/chatwoot) |

### 3. Payment Gateways

| Integration     | Description           | Region             |
| --------------- | --------------------- | ------------------ |
| **M-PESA**      | Mobile money payments | Kenya, East Africa |
| **Flutterwave** | Pan-African payments  | Africa             |
| **Stripe**      | Global payments       | Worldwide          |
| **Paystack**    | Nigerian payments     | Nigeria            |

### 4. AI & Machine Learning

| Integration          | Description    | GitHub                                                      |
| -------------------- | -------------- | ----------------------------------------------------------- |
| **OpenAI**           | GPT-4, GPT-3.5 | [openai/openai-node](https://github.com/openai/openai-node) |
| **Anthropic Claude** | Claude AI      | Official SDK                                                |
| **Google Gemini**    | Gemini Pro     | Official SDK                                                |
| **Ollama**           | Local LLM      | [ollama/ollama](https://github.com/ollama/ollama)           |

### 5. Notifications

| Channel      | Providers                           |
| ------------ | ----------------------------------- |
| **Email**    | SendGrid, Resend, Mailgun           |
| **SMS**      | Twilio, Africa's Talking, Vonage    |
| **Push**     | Firebase Cloud Messaging, OneSignal |
| **WhatsApp** | Twilio WhatsApp                     |

### 6. Data Export & Reporting

| Format           | Description                             |
| ---------------- | --------------------------------------- |
| **Excel (XLSX)** | Full spreadsheet export with formatting |
| **CSV**          | Simple tabular data export              |
| **PDF**          | Professional report generation          |
| **JSON**         | Structured data export                  |
| **XML**          | Structured data export                  |
| **HTML**         | Styled table export                     |
| **Print**        | Optimized print layout                  |

### 7. Offline & Sync

| Feature                 | Description                   |
| ----------------------- | ----------------------------- |
| **IndexedDB**           | Local data storage            |
| **Service Worker**      | Offline support               |
| **Background Sync**     | Automatic sync when online    |
| **Conflict Resolution** | Multiple strategies supported |

## Files Added

```
src/react-app/lib/
├── openSourceIntegrations.tsx  # Analytics & Monitoring integrations
├── aiIntegrations.tsx         # AI & ML integrations
├── paymentIntegrations.tsx    # Payment gateway integrations
├── notificationIntegrations.tsx # Multi-channel notifications
├── exportIntegrations.tsx     # Data export & reporting
├── offlineSync.tsx             # Offline-first sync system
└── index.ts                   # Main export file
```

## Quick Start

### 1. Configure Environment Variables

Add the following to your `.env.local`:

```bash
# PostHog Analytics
VITE_POSTHOG_API_KEY=your-posthog-key

# Chatwoot
VITE_CHATWOOT_WEBSITE_TOKEN=your-chatwoot-token

# M-PESA
VITE_MPESA_CONSUMER_KEY=your-key
VITE_MPESA_CONSUMER_SECRET=your-secret
VITE_MPESA_SHORT_CODE=174379
VITE_MPESA_PASSKEY=your-passkey

# OpenAI
VITE_OPENAI_API_KEY=sk-your-key
```

### 2. Initialize Integrations

```typescript
import { initializeAllIntegrations } from "@/react-app/lib";

await initializeAllIntegrations();
```

### 3. Use Analytics

```typescript
import { useAnalytics, trackAction } from "@/react-app/lib";

// Track an event
trackAction("sale", "completed", "Sale completed", 150.0);

// Or use the hook
const { capture } = useAnalytics();
capture("button_clicked", { button_id: "submit" });
```

### 4. Process Payments

```typescript
import { paymentManager } from "@/react-app/lib";

const result = await paymentManager.processPayment("mpesa", {
  amount: 1000,
  currency: "KES",
  customerPhone: "+254712345678",
  reference: "SALE-001",
});
```

### 5. Send Notifications

```typescript
import { notificationManager } from "@/react-app/lib";

// Send SMS
await notificationManager.send(
  "sms",
  "+254712345678",
  "Your fuel order is ready!",
);

// Send Email
await notificationManager.send(
  "email",
  "customer@example.com",
  "Your receipt",
  {
    subject: "Receipt for Order #123",
  },
);
```

### 6. Export Data

```typescript
import { exportService } from "@/react-app/lib";

const blob = await exportService.exportToExcel(salesData, {
  filename: "sales-report",
  sheetName: "Sales",
});

exportService.downloadBlob(blob, "sales-report.xlsx");
```

### 7. Use Offline Storage

```typescript
import { syncService } from "@/react-app/lib";

// Create with offline support
const sale = await syncService.create("sales", {
  fuel_type: "diesel",
  quantity: 50,
  amount: 7500,
});

// Works offline - syncs when online
const allSales = await syncService.getAll("sales");
```

### 8. AI Assistant

```typescript
import { aiClient, FUELPRO_PROMPTS } from "@/react-app/lib";

const response = await aiClient.chat("openai", [
  {
    id: "1",
    role: "system",
    content: FUELPRO_PROMPTS.salesReport,
    timestamp: Date.now(),
  },
  {
    id: "2",
    role: "user",
    content: "Generate a sales report for today",
    timestamp: Date.now(),
  },
]);
```

## Environment Variables

All integrations can be configured via environment variables. See `.env.example` for the complete list.

### Required Variables

```bash
# Supabase (Core Database)
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

### Optional Variables

```bash
# Analytics
VITE_POSTHOG_API_KEY=
VITE_UMAMI_WEBSITE_ID=

# Error Tracking
VITE_GLITCHTIP_DSN=
VITE_SENTRY_DSN=

# Chat
VITE_CHATWOOT_WEBSITE_TOKEN=

# Payments
VITE_MPESA_CONSUMER_KEY=
VITE_FLUTTERWAVE_PUBLIC_KEY=
VITE_STRIPE_PUBLISHABLE_KEY=
VITE_PAYSTACK_PUBLIC_KEY=

# AI
VITE_OPENAI_API_KEY=
VITE_ANTHROPIC_API_KEY=
VITE_GOOGLE_API_KEY=
```

## Feature Flags

Check which features are available:

```typescript
import { getFeatureFlags, getAvailablePaymentProviders } from "@/react-app/lib";

const flags = getFeatureFlags();
// { analytics: true, chat: true, mpesa: true, ... }

const payments = getAvailablePaymentProviders();
// ['mpesa', 'flutterwave', 'stripe']
```

## Offline Support

The app works offline with automatic sync:

1. All data is stored locally in IndexedDB
2. Changes are queued in the sync queue
3. When online, changes are synced to the server
4. Conflicts are resolved based on configured strategy

### Conflict Resolution Strategies

- **last_write_wins**: Most recent change wins (default)
- **first_write_wins**: First change wins
- **manual**: Show conflict to user for resolution
- **merge**: Attempt to merge changes automatically

## Privacy

All integrations respect user privacy:

- **PostHoc**: Self-hosted option available
- **Umami**: GDPR compliant, no cookies
- **GlitchTip**: Self-hosted error tracking
- **Chatwoot**: Self-hosted live chat

## Support

For issues or questions:

- GitHub Issues: https://github.com/fuelpropay/FUEL_APP_MOBILE/issues
- Documentation: https://fuelpro.com/docs

## License

All open-source integrations maintain their respective licenses.
