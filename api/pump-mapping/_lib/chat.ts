/**
 * Pump Mapping AI Chat Tuner API
 *
 * Handles AI-powered conversations to customize extraction rules
 * for fuel pump ledger documents
 */

// Currency rules
const CURRENCY_RULES: Record<
  string,
  { symbol: string; code: string; name: string }
> = {
  kes: { symbol: "KSh", code: "KES", name: "Kenyan Shilling" },
  kshs: { symbol: "KSh", code: "KES", name: "Kenyan Shilling" },
  kenya: { symbol: "KSh", code: "KES", name: "Kenyan Shilling" },
  usd: { symbol: "$", code: "USD", name: "US Dollar" },
  dollar: { symbol: "$", code: "USD", name: "US Dollar" },
  eur: { symbol: "€", code: "EUR", name: "Euro" },
  euro: { symbol: "€", code: "EUR", name: "Euro" },
  gbp: { symbol: "£", code: "GBP", name: "British Pound" },
  pound: { symbol: "£", code: "GBP", name: "British Pound" },
  tzs: { symbol: "TSh", code: "TZS", name: "Tanzanian Shilling" },
  tanzania: { symbol: "TSh", code: "TZS", name: "Tanzanian Shilling" },
  ugx: { symbol: "USh", code: "UGX", name: "Ugandan Shilling" },
  uganda: { symbol: "USh", code: "UGX", name: "Ugandan Shilling" },
  ngn: { symbol: "₦", code: "NGN", name: "Nigerian Naira" },
  nigeria: { symbol: "₦", code: "NGN", name: "Nigerian Naira" },
  zar: { symbol: "R", code: "ZAR", name: "South African Rand" },
  "south africa": { symbol: "R", code: "ZAR", name: "South African Rand" },
  inr: { symbol: "₹", code: "INR", name: "Indian Rupee" },
  rupee: { symbol: "₹", code: "INR", name: "Indian Rupee" },
  india: { symbol: "₹", code: "INR", name: "Indian Rupee" },
};

// Shift rules
const SHIFT_RULES: Record<
  string,
  { id: string; label: string; hours: string }
> = {
  day: { id: "DAY", label: "Day Shift", hours: "06:00 - 18:00" },
  morning: { id: "DAY", label: "Morning Shift", hours: "05:00 - 13:00" },
  night: { id: "NIGHT", label: "Night Shift", hours: "18:00 - 06:00" },
  evening: { id: "NIGHT", label: "Night Shift", hours: "18:00 - 06:00" },
  afternoon: {
    id: "AFTERNOON",
    label: "Afternoon Shift",
    hours: "13:00 - 21:00",
  },
  full: { id: "FULL", label: "Full Day", hours: "00:00 - 24:00" },
  "24": { id: "FULL", label: "Full Day", hours: "00:00 - 24:00" },
};

// Fuel type rules
const FUEL_RULES: Record<string, string> = {
  pms: "PMS",
  petrol: "PMS",
  gasoline: "PMS",
  regular: "PMS",
  premium: "SUPER",
  super: "SUPER",
  diesel: "AGO",
  ago: "AGO",
  "gas oil": "AGO",
  lpg: "LPG",
  gas: "LPG",
  propane: "LPG",
  butane: "LPG",
  kerosene: "Kerosene",
  paraffin: "Kerosene",
  jet: "Kerosene",
  aviation: "Kerosene",
};

// Parse user request and update rules
function parseRulesUpdate(
  currentRules: string,
  userRequest: string,
): { updatedRules: string; response: string } {
  const lowerRequest = userRequest.toLowerCase();
  let rules = JSON.parse(currentRules);
  let explanation = "";

  // Currency detection
  for (const [keyword, currencyInfo] of Object.entries(CURRENCY_RULES)) {
    if (lowerRequest.includes(keyword)) {
      rules.currencyDetection = currencyInfo.code;
      explanation += `Currency set to ${currencyInfo.name} (${currencyInfo.symbol}). `;
      break;
    }
  }

  // Shift patterns
  for (const [keyword, shiftInfo] of Object.entries(SHIFT_RULES)) {
    if (lowerRequest.includes(keyword) && lowerRequest.includes("shift")) {
      rules.shiftPatterns = rules.shiftPatterns || {};
      rules.shiftPatterns[shiftInfo.id] = [keyword];
      explanation += `Shift pattern updated for ${shiftInfo.label} (${shiftInfo.hours}). `;
      break;
    }
  }

  // Pump ID patterns
  if (
    lowerRequest.includes("pump") &&
    (lowerRequest.includes("format") ||
      lowerRequest.includes("label") ||
      lowerRequest.includes("name"))
  ) {
    if (lowerRequest.includes("p1") || lowerRequest.includes("pump-")) {
      rules.pumpIdPattern = "(PUMP-\\d+|#\\d+)";
      explanation +=
        "Pump ID format updated to recognize patterns like PUMP-1, PUMP-2, etc. ";
    } else if (lowerRequest.includes("#")) {
      rules.pumpIdPattern = "(#\\d+)";
      explanation +=
        "Pump ID format updated to recognize patterns like #001, #002, etc. ";
    } else if (lowerRequest.includes("p ")) {
      rules.pumpIdPattern = "(P\\s*\\d+)";
      explanation +=
        "Pump ID format updated to recognize patterns like P 1, P 2, etc. ";
    } else {
      rules.pumpIdPattern = "(P\\d+)";
      explanation +=
        "Pump ID format updated to recognize patterns like P1, P2, etc. ";
    }
  }

  // Decimal precision
  const decimalMatch = lowerRequest.match(/(\d+)\s*decimal/i);
  if (decimalMatch) {
    rules.decimalPrecision = parseInt(decimalMatch[1]);
    explanation += `Decimal precision set to ${decimalMatch[1]} places. `;
  }

  // Rollover handling
  if (
    lowerRequest.includes("rollover") ||
    lowerRequest.includes("reset") ||
    lowerRequest.includes("meter")
  ) {
    rules.rolloverHandling = {
      enabled: true,
      maxMeterValue: 99999.99,
      formula: "(maxValue - opening) + closing",
    };
    explanation +=
      "Meter rollover handling enabled. When a meter resets (closing < opening), the system will calculate sales as (max value - opening) + closing. ";
  }

  // Sales calculation
  if (lowerRequest.includes("sales") && lowerRequest.includes("calculation")) {
    if (lowerRequest.includes("litres") || lowerRequest.includes("volume")) {
      rules.salesCalculation = "volume-based";
      explanation += "Sales calculation set to volume-based (litres). ";
    } else if (
      lowerRequest.includes("value") ||
      lowerRequest.includes("amount")
    ) {
      rules.salesCalculation = "value-based";
      explanation += "Sales calculation set to value-based (currency amount). ";
    } else {
      rules.salesCalculation = "closing - opening";
      explanation +=
        "Sales calculation set to closing reading minus opening reading. ";
    }
  }

  // Fuel type aliases
  for (const [keyword, fuelType] of Object.entries(FUEL_RULES)) {
    if (lowerRequest.includes(keyword)) {
      rules.fuelTypeAliases = rules.fuelTypeAliases || {};
      rules.fuelTypeAliases[fuelType] = rules.fuelTypeAliases[fuelType] || [];
      if (!rules.fuelTypeAliases[fuelType].includes(keyword)) {
        rules.fuelTypeAliases[fuelType].push(keyword);
      }
      explanation += `Added "${keyword}" as an alias for ${fuelType}. `;
    }
  }

  // Confidence threshold
  const confidenceMatch = lowerRequest.match(/(\d+)\s*%\s*confidence/i);
  if (confidenceMatch) {
    rules.confidenceThreshold = parseInt(confidenceMatch[1]) / 100;
    explanation += `Confidence threshold set to ${confidenceMatch[1]}%. `;
  }

  // Language settings
  if (lowerRequest.includes("swahili")) {
    rules.autoDetectLanguage = false;
    rules.defaultLanguage = "sw";
    explanation += "Default language set to Swahili. ";
  } else if (lowerRequest.includes("french")) {
    rules.autoDetectLanguage = false;
    rules.defaultLanguage = "fr";
    explanation += "Default language set to French. ";
  } else if (lowerRequest.includes("arabic")) {
    rules.autoDetectLanguage = false;
    rules.defaultLanguage = "ar";
    explanation += "Default language set to Arabic. ";
  } else if (lowerRequest.includes("spanish")) {
    rules.autoDetectLanguage = false;
    rules.defaultLanguage = "es";
    explanation += "Default language set to Spanish. ";
  }

  // Rollover threshold
  const thresholdMatch = lowerRequest.match(/rollover.*?(\d+)/i);
  if (thresholdMatch) {
    rules.odometerRolloverThreshold = parseInt(thresholdMatch[1]);
    explanation += `Rollover threshold set to ${thresholdMatch[1]}. `;
  }

  // Reset to defaults
  if (lowerRequest.includes("reset") || lowerRequest.includes("default")) {
    rules = {
      pumpIdPattern: "(P\\d+|Pump\\s*\\d+|\\d{3,4})",
      salesCalculation: "closing - opening",
      rolloverHandling: {
        enabled: true,
        maxMeterValue: 99999.99,
        formula: "(maxValue - opening) + closing",
      },
      decimalPrecision: 2,
      currencyDetection: "auto",
      fuelTypeAliases: {
        PMS: ["PMS", "Petrol", "Premium Motor Spirit", "Gasoline", "Regular"],
        AGO: ["AGO", "Diesel", "Automotive Gas Oil", "Gas Oil"],
        LPG: [
          "LPG",
          "Cooking Gas",
          "Liquefied Petroleum Gas",
          "Propane",
          "Butane",
        ],
        Kerosene: ["Kerosene", "Paraffin", "Jet A1", "Aviation Fuel"],
      },
      shiftPatterns: {
        DAY: ["day", "morning", "am", "6-18"],
        NIGHT: ["night", "evening", "pm", "18-6"],
        FULL: ["full", "24h", "continuous"],
      },
      odometerRolloverThreshold: 1000,
      confidenceThreshold: 0.8,
      autoDetectLanguage: true,
      multiLanguageSupport: true,
    };
    explanation = "Rules reset to default values. ";
  }

  // Default explanation if nothing matched
  if (!explanation) {
    explanation =
      'I understand you want to customize the extraction rules. Please be more specific about what you\'d like to change. For example:\n\n• "Set currency to KSh"\n• "Update pump format to PUMP-1, PUMP-2"\n• "Night shift is 6PM to 6AM"\n• "Use 3 decimal places"\n• "Enable rollover handling"\n• "Reset to defaults"';
  }

  return {
    updatedRules: JSON.stringify(rules, null, 2),
    response: explanation,
  };
}

// Generate AI response using OpenAI (if available)
async function generateAIResponse(
  currentRules: string,
  userRequest: string,
  extractedData: any,
  chatHistory: any[],
): Promise<{ response: string; updatedRules: string }> {
  // Check for OpenAI API key
  const openaiKey =
    process.env.OPENAI_API_KEY || process.env.VITE_OPENAI_API_KEY;

  if (!openaiKey) {
    // Use rule-based parsing
    return parseRulesUpdate(currentRules, userRequest);
  }

  try {
    // Build conversation context
    const systemPrompt = `You are an AI assistant for configuring fuel pump ledger extraction rules.
You help users customize how pump data should be extracted from documents.

Key capabilities:
1. Parse pump readings from various document formats
2. Detect currencies (KES, USD, EUR, etc.) and languages
3. Handle meter rollovers (when closing < opening)
4. Support multiple fuel types: PMS (Petrol), AGO (Diesel), LPG, Kerosene
5. Support multiple shifts: DAY, NIGHT, MORNING, AFTERNOON, FULL

When a user asks to modify rules:
1. Provide clear, executable rule updates
2. Explain what changed and why
3. Keep responses concise and helpful

Return your response as JSON with this structure:
{
  "response": "Your conversational response to the user",
  "updatedRules": "The complete updated rules JSON string"
}`;

    const userPrompt = `Current Rules:
${currentRules}

User Request:
${userRequest}

${
  extractedData
    ? `Current Extracted Data Summary:
- Pumps: ${extractedData.pumps?.length || 0}
- Currency: ${extractedData.metadata?.currency || "Unknown"}
- Language: ${extractedData.metadata?.language_detected || "Unknown"}
- Total Sales: ${extractedData.metadata?.total_value || 0}`
    : ""
}

${
  chatHistory.length > 0
    ? `Recent conversation:\n${chatHistory
        .slice(-3)
        .map((m: any) => `${m.role}: ${m.text.slice(0, 100)}`)
        .join("\n")}`
    : ""
}

Provide your response in JSON format.`;

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${openaiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-3.5-turbo",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.7,
        max_tokens: 1000,
      }),
    });

    if (!response.ok) {
      throw new Error("OpenAI API error");
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = data.choices?.[0]?.message?.content;

    if (content) {
      try {
        const parsed = JSON.parse(content);
        return {
          response:
            parsed.response ||
            parsed.explanation ||
            "Rules updated successfully.",
          updatedRules: parsed.updatedRules || currentRules,
        };
      } catch {
        // If not valid JSON, return as response
        return {
          response: content,
          updatedRules: currentRules,
        };
      }
    }
  } catch (error) {
    console.error("OpenAI API error:", error);
  }

  // Fallback to rule-based parsing
  return parseRulesUpdate(currentRules, userRequest);
}

// Main handler
export async function POST(request: Request): Promise<Response> {
  try {
    const body = (await request.json()) as {
      currentRules?: string;
      userRequest?: string;
      extractedData?: any;
      chatHistory?: any[];
    };
    const { currentRules, userRequest, extractedData, chatHistory } = body;

    if (!userRequest) {
      return new Response(
        JSON.stringify({
          error: "Missing userRequest parameter",
        }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    const { response, updatedRules } = await generateAIResponse(
      currentRules || "{}",
      userRequest,
      extractedData,
      chatHistory || [],
    );

    return new Response(
      JSON.stringify({
        response,
        updatedRules,
        explanation: response,
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    );
  } catch (error) {
    console.error("Chat API error:", error);

    return new Response(
      JSON.stringify({
        error: "Chat processing failed",
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
      name: "Pump Mapping AI Chat Tuner API",
      version: "1.0.0",
      description: "AI-powered conversation for customizing extraction rules",
      usage: {
        method: "POST",
        body: {
          currentRules: "string (JSON) - Current extraction rules",
          userRequest: "string - User message/request",
          extractedData:
            "object (optional) - Current extracted data for context",
          chatHistory: "array (optional) - Recent chat messages",
        },
        response: {
          response: "string - AI response message",
          updatedRules: "string - Updated rules JSON",
          explanation: "string - Brief explanation of changes",
        },
      },
      examples: [
        "Set currency to KSh",
        "Update pump format to PUMP-1, PUMP-2",
        "Night shift is 6PM to 6AM",
        "Enable rollover handling",
        "Use 3 decimal places",
        "Reset to defaults",
      ],
    }),
    {
      status: 200,
      headers: { "Content-Type": "application/json" },
    },
  );
}
