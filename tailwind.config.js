/** @type {import('tailwindcss').Config} */
export default {
  darkMode: "class",
  content: [
    "./index.html",
    "./src/react-app/**/*.{js,ts,jsx,tsx}",
    "./src/components/**/*.{js,ts,jsx,tsx}",
    "./src/pages/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    screens: {
      xs: "380px",
      sm: "640px",
      md: "768px",
      lg: "1024px",
      xl: "1280px",
      "2xl": "1536px",
    },
    extend: {
      fontFamily: {
        sans: ["Inter", "Poppins", "sans-serif"],
        serif: ["Playfair Display", "serif"],
        mono: ["JetBrains Mono", "ui-monospace", "monospace"],
      },
      colors: {
        bg: {
          main: "#0a0e17",
          card: "#111625",
          raised: "#141a2b",
          input: "#1a1f2e",
          hover: "#171d2e",
        },
        gold: {
          DEFAULT: "#c5a059",
          hover: "#d4b475",
          dim: "rgba(197,160,89,0.10)",
          border: "rgba(197,160,89,0.35)",
        },
        stat: {
          primary: "#e7ebf1",
          secondary: "#8a94a6",
          tertiary: "#5b6478",
        },
        status: {
          positive: "#4ade80",
          "positive-dim": "rgba(74,222,128,0.12)",
          warning: "#facc15",
          "warning-dim": "rgba(250,204,21,0.12)",
          negative: "#f87171",
          "negative-dim": "rgba(248,113,113,0.12)",
          info: "#7dd3fc",
          "info-dim": "rgba(125,211,252,0.12)",
        },
        edge: {
          light: "#1f2635",
          lighter: "#252c3f",
        },
      },
      borderRadius: {
        sm: "6px",
        md: "9px",
        lg: "12px",
      },
    },
  },
  plugins: [],
};
