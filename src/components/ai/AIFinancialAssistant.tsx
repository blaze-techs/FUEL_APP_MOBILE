/**
 * AI Financial Assistant Component
 * Uses Groq API for intelligent financial analysis
 */

import { useState, useRef, useEffect } from "react";

interface Message {
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
}

interface AIFinancialAssistantProps {
  apiUrl?: string;
  stationId?: string;
  className?: string;
}

export default function AIFinancialAssistant({
  apiUrl = import.meta.env.VITE_AI_URL || "http://localhost:8000",
  stationId,
  className = "",
}: AIFinancialAssistantProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Check connection on mount
  useEffect(() => {
    checkConnection();
  }, [apiUrl]);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const checkConnection = async () => {
    try {
      const response = await fetch(`${apiUrl}/health`);
      if (response.ok) {
        setIsConnected(true);
        setError(null);
      } else {
        setIsConnected(false);
        setError("AI service unavailable");
      }
    } catch {
      setIsConnected(false);
      setError("Cannot connect to AI service");
    }
  };

  const sendMessage = async () => {
    if (!input.trim() || isLoading) return;

    const userMessage: Message = {
      role: "user",
      content: input.trim(),
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(`${apiUrl}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: userMessage.content,
          station_id: stationId,
          history: messages.map((m) => ({ role: m.role, content: m.content })),
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to get response");
      }

      const data = await response.json();

      const assistantMessage: Message = {
        role: "assistant",
        content: data.response,
        timestamp: new Date(),
      };

      setMessages((prev) => [...prev, assistantMessage]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send message");
    } finally {
      setIsLoading(false);
    }
  };

  const clearChat = () => {
    setMessages([]);
    setError(null);
  };

  const exampleQuestions = [
    "What were my highest expenses last month?",
    "Compare fuel sales vs salon/spa expenses",
    "Show me profit trends for this week",
    "Which attendant made the most sales?",
    "Any low stock alerts?",
  ];

  return (
    <div className={`bg-gray-900 rounded-lg shadow-xl ${className}`}>
      {/* Header */}
      <div className="bg-gradient-to-r from-blue-600 to-purple-600 px-4 py-3 rounded-t-lg flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xl">🤖</span>
          <h3 className="text-white font-semibold">AI Financial Assistant</h3>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={`w-2 h-2 rounded-full ${isConnected ? "bg-green-400" : "bg-red-400"}`}
          ></span>
          <span className="text-xs text-white/80">
            {isConnected ? "Connected" : "Offline"}
          </span>
        </div>
      </div>

      {/* Messages */}
      <div className="h-80 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 && (
          <div className="text-center py-8">
            <p className="text-gray-400 mb-4">
              Ask me anything about your fuel station finances!
            </p>
            <div className="flex flex-wrap gap-2 justify-center">
              {exampleQuestions.map((q, i) => (
                <button
                  key={i}
                  onClick={() => setInput(q)}
                  className="text-xs bg-gray-700 hover:bg-gray-600 text-gray-300 px-3 py-1 rounded-full transition"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <div
            key={i}
            className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`max-w-[80%] px-4 py-2 rounded-lg ${
                msg.role === "user"
                  ? "bg-blue-600 text-white"
                  : "bg-gray-800 text-gray-200"
              }`}
            >
              <p className="text-sm">{msg.content}</p>
              <span className="text-xs opacity-60 mt-1 block">
                {msg.timestamp.toLocaleTimeString()}
              </span>
            </div>
          </div>
        ))}

        {isLoading && (
          <div className="flex justify-start">
            <div className="bg-gray-800 px-4 py-2 rounded-lg">
              <div className="flex gap-1">
                <span
                  className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"
                  style={{ animationDelay: "0ms" }}
                ></span>
                <span
                  className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"
                  style={{ animationDelay: "150ms" }}
                ></span>
                <span
                  className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"
                  style={{ animationDelay: "300ms" }}
                ></span>
              </div>
            </div>
          </div>
        )}

        {error && (
          <div className="text-center text-red-400 text-sm py-2">
            ⚠️ {error}
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="p-4 border-t border-gray-700">
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && sendMessage()}
            placeholder="Ask about sales, expenses, trends..."
            className="flex-1 bg-gray-800 text-white px-4 py-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            disabled={isLoading || !isConnected}
          />
          <button
            onClick={sendMessage}
            disabled={isLoading || !input.trim() || !isConnected}
            className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 disabled:cursor-not-allowed text-white px-4 py-2 rounded-lg transition"
          >
            {isLoading ? <span className="animate-spin">⏳</span> : "Send"}
          </button>
          <button
            onClick={clearChat}
            className="bg-gray-700 hover:bg-gray-600 text-white px-3 py-2 rounded-lg transition"
            title="Clear chat"
          >
            🗑️
          </button>
        </div>
      </div>
    </div>
  );
}
