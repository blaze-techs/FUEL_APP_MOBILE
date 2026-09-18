# Pump Mapping v1 API — Route Documentation

The `/api/pump-mapping` docs index route (`api/pump-mapping/index.ts`) was
removed to stay within the Vercel Hobby 12-serverless-function limit. It was a
GET-only documentation endpoint that was never called by the app (only
`/api/pump-mapping/extract`, `/api/pump-mapping/chat`, and
`/api/pump-mapping/export` are used). The full documentation content is
preserved here.

## Endpoints
- `/api/pump-mapping/extract` — Extract pump data from uploaded files (POST)
- `/api/pump-mapping/chat` — AI chat for customizing extraction rules (POST)
- `/api/pump-mapping/export` — Export extracted data in various formats (POST)

## Features
- File upload: PDF, Images (JPEG/PNG/GIF/WebP), Spreadsheets (XLSX/CSV), text. Max 10MB, 10 files.
- Currencies: KES, USD, EUR, GBP, TZS, UGX, NGN, ZAR, INR, CNY, BRL
- Languages: English, Swahili, French, Arabic, Spanish, Portuguese, German, Chinese, Hindi, Russian
- Fuel types: PMS (Petrol), AGO (Diesel), LPG (Cooking Gas), Kerosene, Super (Premium), ULP (Unleaded)
- Shifts: DAY, NIGHT, MORNING, AFTERNOON, FULL
- Export formats: csv, txt, json, html, pdf, xlsx
- Share methods: email, whatsapp, telegram, sms, copy, print
- AI features: OCR, language detection, currency detection, anomaly detection, AI rule tuning via chat
- Accessibility: text-to-speech, keyboard nav, screen reader, high contrast
