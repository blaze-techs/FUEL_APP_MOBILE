import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.fuelpro.app',
  appName: 'FuelPro',
  webDir: 'dist',
  // Load the live production site in the WebView so updates reach users
  // without an app update (Cloudflare Pages primary, Vercel fallback).
  server: {
    url: 'https://fuel-app-mobile.pages.dev/',
    cleartext: false,
  },
};

export default config;
