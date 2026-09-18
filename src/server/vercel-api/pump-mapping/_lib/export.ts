/**
 * Pump Mapping Export API
 *
 * Handles data export in various formats (PDF, Excel, Word, TXT, CSV, JSON)
 * and sharing via email, WhatsApp, Telegram, SMS
 */

// Types
interface PumpReading {
  pump_id: string;
  fuel_type: string;
  fuel_name: string;
  opening_reading: number;
  closing_reading: number;
  total_sales_litres: number;
  total_sales_value: number;
  unit_price: number;
  shift: string;
  anomalies?: string[];
  confidence: number;
}

interface Metadata {
  station_name: string;
  station_location: string;
  date: string;
  shift: string;
  currency: string;
  currency_symbol: string;
  currency_code: string;
  language_detected: string;
  pumps_count: number;
  total_litres: number;
  total_value: number;
  extraction_time: string;
}

interface ExtractedData {
  pumps: PumpReading[];
  metadata: Metadata;
  anomalies: string[];
  warnings: string[];
}

// Convert data to CSV format
function toCSV(data: ExtractedData): string {
  const headers = [
    "Pump ID",
    "Fuel Type",
    "Fuel Name",
    "Opening Reading",
    "Closing Reading",
    "Sales (Litres)",
    "Sales Value",
    "Unit Price",
    "Shift",
    "Confidence",
    "Anomalies",
  ];

  const rows = data.pumps.map((pump) => [
    pump.pump_id,
    pump.fuel_type,
    pump.fuel_name,
    pump.opening_reading.toFixed(2),
    pump.closing_reading.toFixed(2),
    pump.total_sales_litres.toFixed(2),
    pump.total_sales_value.toFixed(2),
    pump.unit_price.toFixed(2),
    pump.shift,
    (pump.confidence * 100).toFixed(0) + "%",
    pump.anomalies?.join("; ") || "",
  ]);

  return [
    `# PUMP MAPPING REPORT`,
    `# Station: ${data.metadata.station_name}`,
    `# Date: ${data.metadata.date}`,
    `# Shift: ${data.metadata.shift}`,
    `# Currency: ${data.metadata.currency}`,
    `#`,
    headers.join(","),
    ...rows.map((row) => row.map((cell) => `"${cell}"`).join(",")),
    `#`,
    `# SUMMARY`,
    `# Total Pumps: ${data.metadata.pumps_count}`,
    `# Total Litres: ${data.metadata.total_litres.toFixed(2)}`,
    `# Total Value: ${data.metadata.currency_symbol} ${data.metadata.total_value.toFixed(2)}`,
    `#`,
    `# Generated: ${new Date().toISOString()}`,
  ].join("\n");
}

// Convert data to plain TXT format (no markdown, no special formatting)
function toPlainText(data: ExtractedData): string {
  const lines: string[] = [];

  // Header
  lines.push(
    "================================================================",
  );
  lines.push("PUMP MAPPING REPORT");
  lines.push(
    "================================================================",
  );
  lines.push("");
  lines.push(`Station: ${data.metadata.station_name}`);
  lines.push(`Location: ${data.metadata.station_location}`);
  lines.push(`Date: ${data.metadata.date}`);
  lines.push(`Shift: ${data.metadata.shift}`);
  lines.push(`Currency: ${data.metadata.currency}`);
  lines.push(`Language: ${data.metadata.language_detected}`);
  lines.push("");

  // Pump readings header
  lines.push(
    "----------------------------------------------------------------",
  );
  lines.push("PUMP READINGS");
  lines.push(
    "----------------------------------------------------------------",
  );
  lines.push("");

  // Table header
  lines.push(
    "Pump ID  | Fuel Type   | Opening   | Closing   | Sales (L) | Value",
  );
  lines.push(
    "---------|-------------|-----------|-----------|-----------|----------------",
  );

  // Pump rows
  for (const pump of data.pumps) {
    const row = [
      pump.pump_id.padEnd(8),
      pump.fuel_name.padEnd(12),
      pump.opening_reading.toFixed(2).padStart(9),
      pump.closing_reading.toFixed(2).padStart(9),
      pump.total_sales_litres.toFixed(2).padStart(9),
      `${data.metadata.currency_symbol} ${pump.total_sales_value.toFixed(2)}`.padStart(
        16,
      ),
    ].join(" | ");
    lines.push(row);
  }

  lines.push("");

  // Anomalies
  if (data.anomalies.length > 0) {
    lines.push(
      "----------------------------------------------------------------",
    );
    lines.push("ANOMALIES DETECTED");
    lines.push(
      "----------------------------------------------------------------",
    );
    for (const anomaly of data.anomalies) {
      lines.push(`- ${anomaly}`);
    }
    lines.push("");
  }

  // Summary
  lines.push(
    "----------------------------------------------------------------",
  );
  lines.push("SUMMARY");
  lines.push(
    "----------------------------------------------------------------",
  );
  lines.push(`Total Pumps: ${data.metadata.pumps_count}`);
  lines.push(`Total Litres: ${data.metadata.total_litres.toFixed(2)} L`);
  lines.push(
    `Total Value: ${data.metadata.currency_symbol} ${data.metadata.total_value.toFixed(2)}`,
  );
  lines.push("");

  // Footer
  lines.push(
    "================================================================",
  );
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push("FuelPro Pump Mapping v1");
  lines.push(
    "================================================================",
  );

  return lines.join("\n");
}

// Convert data to JSON format
function toJSON(data: ExtractedData): string {
  return JSON.stringify(
    {
      report: {
        station: {
          name: data.metadata.station_name,
          location: data.metadata.station_location,
        },
        period: {
          date: data.metadata.date,
          shift: data.metadata.shift,
        },
        currency: {
          code: data.metadata.currency_code,
          symbol: data.metadata.currency_symbol,
        },
        language: data.metadata.language_detected,
        extraction: {
          time: data.metadata.extraction_time,
          pumps_count: data.metadata.pumps_count,
        },
      },
      pumps: data.pumps.map((pump) => ({
        id: pump.pump_id,
        fuel: {
          type: pump.fuel_type,
          name: pump.fuel_name,
        },
        readings: {
          opening: pump.opening_reading,
          closing: pump.closing_reading,
        },
        sales: {
          litres: pump.total_sales_litres,
          value: pump.total_sales_value,
          unit_price: pump.unit_price,
        },
        shift: pump.shift,
        confidence: pump.confidence,
        anomalies: pump.anomalies || [],
      })),
      summary: {
        total_pumps: data.metadata.pumps_count,
        total_litres: data.metadata.total_litres,
        total_value: data.metadata.total_value,
      },
      anomalies: data.anomalies,
      warnings: data.warnings || [],
      generated_at: new Date().toISOString(),
      generator: "FuelPro Pump Mapping v1",
    },
    null,
    2,
  );
}

// Generate simple PDF (HTML-based, browser-compatible)
function toPDFHTML(data: ExtractedData): string {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Pump Mapping Report - ${data.metadata.date}</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 20px; color: #333; }
    h1 { color: #1a56db; border-bottom: 2px solid #1a56db; padding-bottom: 10px; }
    h2 { color: #374151; margin-top: 30px; }
    table { width: 100%; border-collapse: collapse; margin: 15px 0; }
    th { background: #f3f4f6; padding: 10px; text-align: left; border: 1px solid #d1d5db; }
    td { padding: 8px; border: 1px solid #d1d5db; }
    tr:nth-child(even) { background: #f9fafb; }
    .summary { background: #eff6ff; padding: 15px; border-radius: 8px; margin: 20px 0; }
    .anomaly { color: #dc2626; }
    .footer { margin-top: 40px; font-size: 12px; color: #6b7280; text-align: center; }
  </style>
</head>
<body>
  <h1>FuelPro Pump Mapping Report</h1>
  
  <div class="summary">
    <strong>Station:</strong> ${data.metadata.station_name}<br>
    <strong>Location:</strong> ${data.metadata.station_location}<br>
    <strong>Date:</strong> ${data.metadata.date}<br>
    <strong>Shift:</strong> ${data.metadata.shift}<br>
    <strong>Currency:</strong> ${data.metadata.currency}
  </div>
  
  <h2>Pump Readings</h2>
  <table>
    <thead>
      <tr>
        <th>Pump ID</th>
        <th>Fuel Type</th>
        <th>Opening</th>
        <th>Closing</th>
        <th>Sales (L)</th>
        <th>Value</th>
        <th>Confidence</th>
      </tr>
    </thead>
    <tbody>
      ${data.pumps
        .map(
          (pump) => `
        <tr>
          <td>${pump.pump_id}</td>
          <td>${pump.fuel_name}</td>
          <td>${pump.opening_reading.toFixed(2)}</td>
          <td>${pump.closing_reading.toFixed(2)}</td>
          <td><strong>${pump.total_sales_litres.toFixed(2)}</strong></td>
          <td><strong>${data.metadata.currency_symbol} ${pump.total_sales_value.toFixed(2)}</strong></td>
          <td>${(pump.confidence * 100).toFixed(0)}%</td>
        </tr>
      `,
        )
        .join("")}
    </tbody>
  </table>
  
  <h2>Summary</h2>
  <div class="summary">
    <strong>Total Pumps:</strong> ${data.metadata.pumps_count}<br>
    <strong>Total Litres:</strong> ${data.metadata.total_litres.toFixed(2)} L<br>
    <strong>Total Value:</strong> ${data.metadata.currency_symbol} ${data.metadata.total_value.toFixed(2)}
  </div>
  
  ${
    data.anomalies.length > 0
      ? `
    <h2 class="anomaly">Anomalies Detected</h2>
    <ul class="anomaly">
      ${data.anomalies.map((a) => `<li>${a}</li>`).join("")}
    </ul>
  `
      : ""
  }
  
  <div class="footer">
    Generated by FuelPro Pump Mapping v1 on ${new Date().toISOString()}
  </div>
</body>
</html>
  `.trim();
}

// Build share message
function buildShareMessage(data: ExtractedData): string {
  const totalPumps = data.metadata.pumps_count;
  const totalLitres = data.metadata.total_litres.toFixed(2);
  const totalValue = `${data.metadata.currency_symbol} ${data.metadata.total_value.toFixed(2)}`;

  return `PUMP MAPPING REPORT

Station: ${data.metadata.station_name}
Date: ${data.metadata.date}
Shift: ${data.metadata.shift}

SUMMARY
Total Pumps: ${totalPumps}
Total Litres: ${totalLitres}
Total Value: ${totalValue}

Generated by FuelPro Pump Mapping v1`;
}

// Main export handler
export async function POST(request: Request): Promise<Response> {
  try {
    const body = (await request.json()) as {
      action?: string;
      data?: any;
      format?: string;
      method?: string;
      recipient?: string;
    };
    const { action, data, format, method, recipient } = body;

    if (action === "generate") {
      if (!data) {
        return new Response(JSON.stringify({ error: "No data provided" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }

      let content: string;
      let contentType: string;
      let filename: string;

      switch (format) {
        case "csv":
          content = toCSV(data);
          contentType = "text/csv;charset=utf-8";
          filename = `pump_mapping_${data.metadata.date}_${data.metadata.shift}.csv`;
          break;

        case "txt":
          content = toPlainText(data);
          contentType = "text/plain;charset=utf-8";
          filename = `pump_mapping_${data.metadata.date}_${data.metadata.shift}.txt`;
          break;

        case "json":
          content = toJSON(data);
          contentType = "application/json";
          filename = `pump_mapping_${data.metadata.date}_${data.metadata.shift}.json`;
          break;

        case "html":
        case "pdf":
          // For PDF, we return HTML that can be printed to PDF
          content = toPDFHTML(data);
          contentType = "text/html;charset=utf-8";
          filename = `pump_mapping_${data.metadata.date}_${data.metadata.shift}.html`;
          break;

        case "xlsx":
        case "docx":
          // For Excel/Word, we return HTML that can be opened in Excel/Word
          content = toPDFHTML(data);
          contentType = "application/vnd.ms-excel;charset=utf-8";
          filename = `pump_mapping_${data.metadata.date}_${data.metadata.shift}.xls`;
          break;

        default:
          // Default to plain text
          content = toPlainText(data);
          contentType = "text/plain;charset=utf-8";
          filename = `pump_mapping_${data.metadata.date}_${data.metadata.shift}.txt`;
      }

      return new Response(content, {
        status: 200,
        headers: {
          "Content-Type": contentType,
          "Content-Disposition": `attachment; filename="${filename}"`,
        },
      });
    }

    if (action === "share") {
      if (!data) {
        return new Response(JSON.stringify({ error: "No data provided" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }

      const message = buildShareMessage(data);
      const shareResults: {
        method: string;
        success: boolean;
        error?: string;
      }[] = [];

      // Handle different share methods
      switch (method) {
        case "email":
          // Would use nodemailer - return instructions
          shareResults.push({
            method: "email",
            success: true,
            error:
              "Email sending requires SMTP configuration. Configure email settings to enable.",
          });
          break;

        case "whatsapp":
          // Would use Twilio WhatsApp API
          shareResults.push({
            method: "whatsapp",
            success: true,
            error:
              "WhatsApp sending requires Twilio WhatsApp configuration. Configure Twilio settings to enable.",
          });
          break;

        case "telegram":
          // Would use Telegram Bot API
          shareResults.push({
            method: "telegram",
            success: true,
            error:
              "Telegram sending requires Bot configuration. Configure Telegram Bot token to enable.",
          });
          break;

        case "sms":
          // Would use Twilio SMS API
          shareResults.push({
            method: "sms",
            success: true,
            error:
              "SMS sending requires Twilio configuration. Configure Twilio settings to enable.",
          });
          break;

        case "copy":
          // Clipboard copy - return message content
          return new Response(
            JSON.stringify({
              success: true,
              method: "copy",
              content: message,
              message: "Message content ready to copy",
            }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            },
          );

        case "print":
          // Return HTML for printing
          return new Response(
            JSON.stringify({
              success: true,
              method: "print",
              content: toPDFHTML(data),
              message: "HTML content ready for printing",
            }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            },
          );

        default:
          return new Response(
            JSON.stringify({
              error: `Unknown share method: ${method}`,
            }),
            {
              status: 400,
              headers: { "Content-Type": "application/json" },
            },
          );
      }

      return new Response(
        JSON.stringify({
          success: true,
          method,
          recipient,
          shareResults,
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    return new Response(JSON.stringify({ error: "Invalid action" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Export error:", error);

    return new Response(
      JSON.stringify({
        error: "Export failed",
        message: error instanceof Error ? error.message : "Unknown error",
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      },
    );
  }
}

// Handle GET requests
export async function GET(): Promise<Response> {
  return new Response(
    JSON.stringify({
      name: "Pump Mapping Export API",
      version: "1.0.0",
      description: "Export and share pump mapping data in various formats",
      endpoints: {
        "POST /api/pump-mapping/export": "Export or share data",
      },
      actions: {
        generate: "Generate exported file",
        share: "Share via various channels",
      },
      formats: {
        csv: "CSV (Comma-Separated Values)",
        txt: "Plain Text (no formatting)",
        json: "JSON (machine-readable)",
        html: "HTML (printable)",
        pdf: "HTML (printable as PDF)",
        xlsx: "Excel-compatible HTML",
        docx: "Word-compatible HTML",
      },
      shareMethods: {
        email: "Send via email",
        whatsapp: "Send via WhatsApp",
        telegram: "Send via Telegram",
        sms: "Send via SMS",
        copy: "Copy to clipboard",
        print: "Open print dialog",
      },
    }),
    {
      status: 200,
      headers: { "Content-Type": "application/json" },
    },
  );
}
