import { useState, useRef, useEffect } from "react";
import {
  Sparkles,
  Send,
  User,
  Bot,
  X,
  Loader2,
  TrendingUp,
  FileText,
  Fuel,
  DollarSign,
  BarChart3,
  Lightbulb,
} from "lucide-react";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: string;
}

const WELCOME_MESSAGE = `Welcome to FuelPro AI Assistant! I can help you with:

- **Sales Analysis** - Analyze sales trends and patterns
- **Fuel Pricing** - Get pricing recommendations
- **Inventory Alerts** - Check stock levels and reorder needs
- **Financial Insights** - Margin analysis and profitability
- **Document Help** - Assist with compliance and reports

How can I help you today?`;

const QUICK_PROMPTS = [
  {
    icon: TrendingUp,
    label: "Analyze sales trend",
    prompt:
      "Analyze my sales trend for the past week. What patterns do you see?",
  },
  {
    icon: Fuel,
    label: "Fuel price advice",
    prompt:
      "What fuel pricing strategy should I use based on current market conditions?",
  },
  {
    icon: DollarSign,
    label: "Check margins",
    prompt:
      "Calculate my profit margins across all fuel types and suggest improvements.",
  },
  {
    icon: BarChart3,
    label: "Inventory status",
    prompt:
      "Analyze my current inventory levels. Do I need to reorder anything?",
  },
];

export default function AIAssistant() {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: "assistant",
      content: WELCOME_MESSAGE,
      timestamp: new Date().toISOString(),
    },
  ]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const sendToAI = async (userMessage: string) => {
    setIsLoading(true);
    const systemPrompt = `You are FuelPro AI, a specialized assistant for fuel station management in Africa. You help with sales analysis, fuel pricing, inventory management, tax compliance (KRA/URA/TRA), and operational efficiency. Be concise, practical, and data-driven. Use local currency (Ksh) where relevant.`;

    try {
      const response = await fetch(
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=AIzaSy_REPLACE_WITH_GOOGLE_API_KEY",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [
              { role: "user", parts: [{ text: systemPrompt }] },
              {
                role: "model",
                parts: [
                  {
                    text: "I understand. I am FuelPro AI, ready to help with fuel station management.",
                  },
                ],
              },
              { role: "user", parts: [{ text: userMessage }] },
            ],
            generationConfig: { temperature: 0.7, maxOutputTokens: 800 },
          }),
        }
      );

      if (!response.ok) throw new Error("AI request failed");
      const data = await response.json();
      const text =
        data.candidates?.[0]?.content?.parts?.[0]?.text ||
        "Sorry, I could not process that request.";
      setMessages(prev => [
        ...prev,
        {
          role: "assistant",
          content: text,
          timestamp: new Date().toISOString(),
        },
      ]);
    } catch {
      setMessages(prev => [
        ...prev,
        {
          role: "assistant",
          content:
            "I apologize, but I am currently unable to connect to the AI service. Please check your internet connection and try again.",
          timestamp: new Date().toISOString(),
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSend = () => {
    if (!input.trim() || isLoading) return;
    const userMsg = input.trim();
    setMessages(prev => [
      ...prev,
      { role: "user", content: userMsg, timestamp: new Date().toISOString() },
    ]);
    setInput("");
    sendToAI(userMsg);
  };

  const handleQuickPrompt = (prompt: string) => {
    setMessages(prev => [
      ...prev,
      { role: "user", content: prompt, timestamp: new Date().toISOString() },
    ]);
    sendToAI(prompt);
  };

  return (
    <>
      {/* Floating Button */}
      {!isOpen && (
        <button
          onClick={() => setIsOpen(true)}
          className="fixed bottom-6 right-6 z-40 w-14 h-14 bg-gradient-to-br from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white rounded-full shadow-xl flex items-center justify-center transition-all hover:scale-105"
        >
          <Sparkles size={24} />
        </button>
      )}

      {/* Chat Panel */}
      {isOpen && (
        <div className="fixed bottom-6 right-6 z-40 w-[380px] max-w-[calc(100vw-48px)] h-[550px] max-h-[calc(100vh-96px)] bg-white dark:bg-gray-800 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 flex flex-col overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 bg-gradient-to-r from-purple-600 to-indigo-600 text-white">
            <div className="flex items-center gap-2">
              <Sparkles size={18} />
              <span className="text-sm font-semibold">FuelPro AI</span>
            </div>
            <button
              onClick={() => setIsOpen(false)}
              className="p-1 hover:bg-white/20 rounded-lg transition-colors"
            >
              <X size={18} />
            </button>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {messages.map((msg, i) => (
              <div
                key={i}
                className={`flex gap-2 ${msg.role === "user" ? "flex-row-reverse" : ""}`}
              >
                <div
                  className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 ${
                    msg.role === "user"
                      ? "bg-blue-100 text-blue-600"
                      : "bg-purple-100 text-purple-600"
                  }`}
                >
                  {msg.role === "user" ? <User size={14} /> : <Bot size={14} />}
                </div>
                <div
                  className={`max-w-[80%] px-3 py-2 rounded-xl text-xs leading-relaxed ${
                    msg.role === "user"
                      ? "bg-blue-600 text-white rounded-tr-sm"
                      : "bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200 rounded-tl-sm"
                  }`}
                >
                  <div className="whitespace-pre-wrap">{msg.content}</div>
                </div>
              </div>
            ))}

            {isLoading && (
              <div className="flex gap-2">
                <div className="w-7 h-7 rounded-full bg-purple-100 text-purple-600 flex items-center justify-center flex-shrink-0">
                  <Bot size={14} />
                </div>
                <div className="bg-gray-100 dark:bg-gray-700 px-3 py-2 rounded-xl rounded-tl-sm">
                  <Loader2 size={14} className="animate-spin text-purple-500" />
                </div>
              </div>
            )}

            {/* Quick Prompts */}
            {messages.length === 1 && !isLoading && (
              <div className="grid grid-cols-2 gap-2 mt-2">
                {QUICK_PROMPTS.map((qp, i) => (
                  <button
                    key={i}
                    onClick={() => handleQuickPrompt(qp.prompt)}
                    className="flex items-center gap-2 p-2 bg-gray-50 dark:bg-gray-700 hover:bg-purple-50 dark:hover:bg-purple-900/20 rounded-lg text-left transition-colors border border-gray-200 dark:border-gray-600"
                  >
                    <qp.icon
                      size={14}
                      className="text-purple-500 flex-shrink-0"
                    />
                    <span className="text-[11px] text-gray-700 dark:text-gray-300">
                      {qp.label}
                    </span>
                  </button>
                ))}
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <div className="p-3 border-t border-gray-200 dark:border-gray-700">
            <div className="flex gap-2">
              <input
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleSend()}
                placeholder="Ask FuelPro AI..."
                className="flex-1 px-3 py-2 bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-600 rounded-lg text-xs dark:text-white focus:ring-2 focus:ring-purple-500 outline-none"
              />
              <button
                onClick={handleSend}
                disabled={isLoading || !input.trim()}
                className="px-3 py-2 bg-purple-600 hover:bg-purple-700 disabled:bg-gray-400 text-white rounded-lg transition-colors"
              >
                <Send size={14} />
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
