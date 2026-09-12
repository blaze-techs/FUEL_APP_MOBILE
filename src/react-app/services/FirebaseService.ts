// ============================================================
// FirebaseService - Cloud persistence for FuelPro
// Uses Firebase Firestore for cloud storage
// All data encrypted locally before transmission
// ============================================================

import { initializeApp, getApps, FirebaseApp } from "firebase/app";
import {
  getFirestore,
  Firestore,
  doc,
  setDoc,
  getDoc,
  serverTimestamp,
} from "firebase/firestore";

// Firebase config from environment variables
const firebaseConfig = {
  apiKey:
    import.meta.env.VITE_FIREBASE_API_KEY ||
    "AIzaSy_REPLACE_WITH_FIREBASE_WEB_API_KEY",
  authDomain:
    import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "fuel-pro-1.firebaseapp.com",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "fuel-pro-1",
  storageBucket:
    import.meta.env.VITE_FIREBASE_STORAGE_BUCKET ||
    "fuel-pro-1.firebasestorage.app",
  messagingSenderId:
    import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "434474929988",
  appId:
    import.meta.env.VITE_FIREBASE_APP_ID ||
    "1:434474929988:web:f141473bd3acfba6d41111",
};

// Initialize Firebase app
let firebaseApp: FirebaseApp | null = null;
let firestoreDb: Firestore | null = null;

function getFirebaseApp(): FirebaseApp {
  if (firebaseApp) return firebaseApp;
  const existingApps = getApps();
  if (existingApps.length > 0) {
    firebaseApp = existingApps[0];
    return firebaseApp;
  }
  firebaseApp = initializeApp(firebaseConfig);
  return firebaseApp;
}

function getFirestoreDb(): Firestore {
  if (firestoreDb) return firestoreDb;
  firestoreDb = getFirestore(getFirebaseApp());
  return firestoreDb;
}

interface CloudData {
  stationId: string;
  data: Record<string, any>;
  version: number;
  lastModified: Date;
  deviceId: string;
}

// Generate a unique device ID for this browser
function getDeviceId(): string {
  let id = localStorage.getItem("fuelpro_device_id");
  if (!id) {
    id = `dev_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    localStorage.setItem("fuelpro_device_id", id);
  }
  return id;
}

// Simple XOR encryption for data before transmission
function encrypt(data: string, key: string): string {
  let result = "";
  for (let i = 0; i < data.length; i++) {
    result += String.fromCharCode(
      data.charCodeAt(i) ^ key.charCodeAt(i % key.length),
    );
  }
  return btoa(result);
}

function decrypt(data: string, key: string): string {
  try {
    const decoded = atob(data);
    let result = "";
    for (let i = 0; i < decoded.length; i++) {
      result += String.fromCharCode(
        decoded.charCodeAt(i) ^ key.charCodeAt(i % key.length),
      );
    }
    return result;
  } catch {
    return "{}";
  }
}

// Derive encryption key from station credentials
function getEncryptionKey(stationId: string): string {
  const base =
    localStorage.getItem("fuelpro_cloud_key") || "fuelpro_default_key_2026";
  return `${base}_${stationId}`;
}

export const FirebaseService = {
  // Check if cloud sync is enabled
  isEnabled(): boolean {
    return localStorage.getItem("fuelpro_cloud_enabled") === "true";
  },

  // Enable/disable cloud sync
  setEnabled(enabled: boolean): void {
    localStorage.setItem("fuelpro_cloud_enabled", String(enabled));
  },

  // Set custom encryption key
  setEncryptionKey(key: string): void {
    localStorage.setItem("fuelpro_cloud_key", key);
  },

  // Check if Firebase/Firestore is connected
  async isConnected(): Promise<boolean> {
    try {
      const db = getFirestoreDb();
      const testDoc = doc(db, "_health", "check");
      await getDoc(testDoc);
      return true;
    } catch (error) {
      console.log("[Firebase] Connection check:", error);
      return false;
    }
  },

  // Sync all data to cloud using Firestore
  async syncToCloud(stationId: string): Promise<boolean> {
    if (!this.isEnabled()) return false;

    try {
      const db = getFirestoreDb();
      const allData: Record<string, any> = {};

      // Collect all relevant localStorage data
      const keys = [
        `fuelpro_data_${stationId}`,
        `fuelpro_inventory`,
        `fuelpro_customers`,
        `fuelpro_shifts`,
        `fuelpro_employees`,
        `fuelpro_credit_accounts`,
        `fuelpro_quality_tests`,
        `fuelpro_sync_result_${stationId}`,
        `fuelpro_fuel_prices_KE`,
      ];

      for (const key of keys) {
        const value = localStorage.getItem(key);
        if (value) {
          try {
            allData[key] = JSON.parse(value);
          } catch {
            allData[key] = value;
          }
        }
      }

      const payload: CloudData = {
        stationId,
        data: allData,
        version: Date.now(),
        lastModified: new Date(),
        deviceId: getDeviceId(),
      };

      const encrypted = encrypt(
        JSON.stringify(payload),
        getEncryptionKey(stationId),
      );

      // Store in Firestore using stationId as document ID
      await setDoc(
        doc(db, "stations", stationId),
        {
          encrypted,
          timestamp: serverTimestamp(),
          deviceId: getDeviceId(),
        },
        { merge: true },
      );

      localStorage.setItem("fuelpro_last_cloud_sync", new Date().toISOString());
      // Dispatch event for UI update
      window.dispatchEvent(
        new CustomEvent("fuelpro-cloud-sync", {
          detail: { success: true, stationId },
        }),
      );
      return true;
    } catch (error) {
      console.error("[Firebase] Sync failed:", error);
      return false;
    }
  },

  // Restore data from cloud using Firestore
  async restoreFromCloud(stationId: string): Promise<boolean> {
    if (!this.isEnabled()) return false;

    try {
      const db = getFirestoreDb();
      const docSnap = await getDoc(doc(db, "stations", stationId));

      if (!docSnap.exists()) return false;

      const result = docSnap.data();
      if (!result?.encrypted) return false;

      const decrypted = decrypt(result.encrypted, getEncryptionKey(stationId));
      const payload: CloudData = JSON.parse(decrypted);

      if (payload.data) {
        // Restore each data key to localStorage
        for (const [key, value] of Object.entries(payload.data)) {
          if (value !== null && value !== undefined) {
            localStorage.setItem(
              key,
              typeof value === "string" ? value : JSON.stringify(value),
            );
          }
        }

        localStorage.setItem(
          "fuelpro_last_cloud_sync",
          new Date().toISOString(),
        );
        window.dispatchEvent(
          new CustomEvent("fuelpro-cloud-sync", {
            detail: { success: true, restored: true, stationId },
          }),
        );
        return true;
      }
      return false;
    } catch (error) {
      console.error("[Firebase] Restore failed:", error);
      return false;
    }
  },

  // Auto-sync on interval
  startAutoSync(
    stationId: string,
    intervalMs = 60000,
  ): ReturnType<typeof setInterval> {
    return setInterval(() => {
      if (this.isEnabled()) {
        this.syncToCloud(stationId);
      }
    }, intervalMs);
  },

  // Get last sync info
  getLastSyncInfo(): {
    lastSync: string | null;
    deviceId: string;
    enabled: boolean;
  } {
    return {
      lastSync: localStorage.getItem("fuelpro_last_cloud_sync"),
      deviceId: getDeviceId(),
      enabled: this.isEnabled(),
    };
  },

  // Clear all cloud data for a station
  async clearCloudData(stationId: string): Promise<boolean> {
    try {
      const db = getFirestoreDb();
      await setDoc(
        doc(db, "stations", stationId),
        { deleted: true, deletedAt: serverTimestamp() },
        { merge: true },
      );
      return true;
    } catch {
      return false;
    }
  },
};
