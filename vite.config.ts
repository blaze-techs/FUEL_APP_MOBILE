import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

// Plugin to replace __BUILD_VERSION__ in index.html during build.
function buildVersionPlugin() {
  return {
    name: "build-version-stamp",
    transformIndexHtml(html) {
      try {
        const versionPath = path.resolve(__dirname, ".build-version");
        if (!fs.existsSync(versionPath)) return html;
        const version = fs.readFileSync(versionPath, "utf-8").trim();
        return html.replace(
          /(__BUILD_VERSION__\s*=\s*)"__BUILD_VERSION__"/g,
          '$1"' + version + '"',
        );
      } catch (e) {
        return html;
      }
    },
  };
}

export default defineConfig({
  plugins: [
    buildVersionPlugin(),
    react(),
    VitePWA({
      registerType: "autoUpdate",
      // SW registration + update handling is in index.html (inline script).
      // Disabling the plugin's auto-inject avoids a duplicate minimal
      // registration that doesn't handle updates.
      injectRegister: false,
      includeAssets: [
        "favicon.ico",
        "favicon-16x16.png",
        "favicon-32x32.png",
        "apple-touch-icon.png",
        "icon-192.png",
        "icon-512.png",
        "og-image.png",
        "logo-main.jpg",
        "logo-small.jpg",
        "robots.txt",
        "sitemap.xml",
        "llms.txt",
        "*.svg",
      ],
      manifest: {
        name: "FuelPro — Fuel Station Management System",
        short_name: "FuelPro",
        description:
          "All-in-one fuel station management: POS, inventory, M-PESA payments, invoicing, payroll, compliance, and real-time analytics.",
        theme_color: "#c5a059",
        background_color: "#0a0e17",
        display: "standalone",
        orientation: "any",
        scope: "/",
        start_url: "/",
        icons: [
          {
            src: "/icon-192.png",
            sizes: "192x192",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "/icon-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "/icon-192.png",
            sizes: "192x192",
            type: "image/png",
            purpose: "maskable",
          },
          {
            src: "/icon-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
        categories: ["business", "productivity", "finance"],
        shortcuts: [
          {
            name: "Dashboard",
            short_name: "Dashboard",
            description: "View station dashboard",
            url: "/#/?tab=dashboard",
          },
          {
            name: "Point of Sale",
            short_name: "POS",
            description: "Quick fuel sales",
            url: "/#/?tab=pos",
          },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,ico,png,svg,jpg,jpeg,woff,woff2}"],
        // Do NOT precache index.html — always fetch from network so new
        // deploys are visible immediately (the fresh index.html references
        // new chunk filenames which the SW then fetches from network).
        globIgnores: ["**/index.html"],
        cleanupOutdatedCaches: true,
        skipWaiting: true,
        clientsClaim: true,
        // Never serve a cached fallback for navigations. This ensures the
        // browser always hits the network for the HTML shell.
        navigateFallback: null,
        runtimeCaching: [
          {
            // Always fetch HTML/navigations from network first (5s timeout
            // then falls back to cache for offline support).
            urlPattern: ({ url }) =>
              url.pathname === "/" ||
              url.pathname.endsWith(".html") ||
              url.pathname.startsWith("/#"),
            handler: "NetworkFirst",
            options: {
              cacheName: "html-cache",
              networkTimeoutSeconds: 5,
              expiration: {
                maxEntries: 10,
                maxAgeSeconds: 0, // Always revalidate
              },
              cacheableResponse: {
                statuses: [0, 200],
              },
            },
          },
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: "CacheFirst",
            options: {
              cacheName: "google-fonts-cache",
              expiration: {
                maxEntries: 10,
                maxAgeSeconds: 60 * 60 * 24 * 365, // 1 year
              },
              cacheableResponse: {
                statuses: [0, 200],
              },
            },
          },
          {
            urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
            handler: "CacheFirst",
            options: {
              cacheName: "gstatic-fonts-cache",
              expiration: {
                maxEntries: 10,
                maxAgeSeconds: 60 * 60 * 24 * 365, // 1 year
              },
              cacheableResponse: {
                statuses: [0, 200],
              },
            },
          },
          {
            urlPattern: /^https:\/\/ojjscjwatikixlpshmub\.supabase\.co\/.*/i,
            handler: "NetworkFirst",
            options: {
              cacheName: "supabase-cache",
              expiration: {
                maxEntries: 50,
                maxAgeSeconds: 60 * 60, // 1 hour
              },
              networkTimeoutSeconds: 10,
            },
          },
        ],
      },
      devOptions: {
        enabled: true,
        type: "module",
      },
    }),
  ],
  server: {
    allowedHosts: true,
    host: "0.0.0.0",
    port: 5000,
  },
  build: {
    chunkSizeWarningLimit: 5000,
    // Never ship production source maps — keeps bundles smaller and avoids
    // exposing full source in the browser devtools.
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: {
          // Split heavy vendor libraries into long-cacheable chunks so the
          // main entry bundle stays lean.
          vendor: ["react", "react-dom", "react-router"],
          trpc: ["@trpc/react-query", "@trpc/client", "@tanstack/react-query"],
          supabase: ["@supabase/supabase-js"],
          charts: ["chart.js", "react-chartjs-2"],
          sentry: ["@sentry/react"],
          media: ["hls.js"],
          transformers: ["@xenova/transformers"],
          // Code split large components to prevent chunk loading failures
          founder: ["./src/react-app/pages/FounderAccess.tsx"],
          pos: ["./src/react-app/components/PointOfSale.tsx"],
          reports: ["./src/react-app/components/ReportsCenter.tsx"],
        },
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@contracts": path.resolve(__dirname, "./contracts"),
      "@db": path.resolve(__dirname, "./db"),
      db: path.resolve(__dirname, "./db"),
    },
  },
  envDir: path.resolve(__dirname),
});
