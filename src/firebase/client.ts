/**
 * Firebase Client SDK Configuration
 *
 * This file configures Firebase Client SDK for browser-side operations.
 * Used for:
 * - User authentication (sign-in/sign-up)
 * - Real-time database listeners
 * - Client-side data access
 * - Cloud messaging
 */

import { initializeApp, getApps, FirebaseApp } from "firebase/app";
import { getAuth, Auth, connectAuthEmulator } from "firebase/auth";
import {
  getFirestore,
  Firestore,
  connectFirestoreEmulator,
} from "firebase/firestore";
import {
  getDatabase,
  Database,
  connectDatabaseEmulator,
} from "firebase/database";
import {
  getStorage,
  FirebaseStorage,
  connectStorageEmulator,
} from "firebase/storage";

// Firebase configuration from environment variables
const firebaseConfig = {
  apiKey:
    import.meta.env.VITE_FIREBASE_API_KEY ||
    "AIzaSy_REPLACE_WITH_FIREBASE_WEB_API_KEY",
  authDomain:
    import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "fuel-pro-1.firebaseapp.com",
  databaseURL:
    import.meta.env.VITE_FIREBASE_DATABASE_URL ||
    "https://fuel-pro-1.firebaseio.com",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "fuel-pro-1",
  storageBucket:
    import.meta.env.VITE_FIREBASE_STORAGE_BUCKET ||
    "fuel-pro-1.firebasestorage.app",
  messagingSenderId:
    import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "434474929988",
  appId:
    import.meta.env.VITE_FIREBASE_APP_ID ||
    "1:434474929988:web:f141473bd3acfba6d41111",
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID || "G-XYZ4QZX2Z4",
};

// Singleton Firebase app instance
let firebaseApp: FirebaseApp | null = null;
let firebaseAuth: Auth | null = null;
let firebaseFirestore: Firestore | null = null;
let firebaseDatabase: Database | null = null;
let firebaseStorage: FirebaseStorage | null = null;

/**
 * Initialize Firebase app (singleton pattern)
 */
export function getFirebaseApp(): FirebaseApp {
  if (firebaseApp) {
    return firebaseApp;
  }

  // Check if Firebase is already initialized
  const existingApps = getApps();
  if (existingApps.length > 0) {
    firebaseApp = existingApps[0];
    return firebaseApp;
  }

  // Initialize with config
  firebaseApp = initializeApp(firebaseConfig);
  return firebaseApp;
}

/**
 * Get Firebase Authentication instance
 */
export function getFirebaseAuth(): Auth {
  if (firebaseAuth) {
    return firebaseAuth;
  }

  const app = getFirebaseApp();
  firebaseAuth = getAuth(app);

  // Connect to emulator in development if configured
  if (import.meta.env.VITE_USE_FIREBASE_EMULATOR === "true") {
    connectAuthEmulator(firebaseAuth, "http://localhost:9099", {
      disableWarnings: true,
    });
  }

  return firebaseAuth;
}

/**
 * Get Firestore instance
 */
export function getFirebaseFirestore(): Firestore {
  if (firebaseFirestore) {
    return firebaseFirestore;
  }

  const app = getFirebaseApp();
  firebaseFirestore = getFirestore(app);

  // Connect to emulator in development if configured
  if (import.meta.env.VITE_USE_FIREBASE_EMULATOR === "true") {
    connectFirestoreEmulator(firebaseFirestore, "localhost", 8080);
  }

  return firebaseFirestore;
}

/**
 * Get Realtime Database instance
 */
export function getFirebaseDatabase(): Database {
  if (firebaseDatabase) {
    return firebaseDatabase;
  }

  const app = getFirebaseApp();
  firebaseDatabase = getDatabase(app);

  // Connect to emulator in development if configured
  if (import.meta.env.VITE_USE_FIREBASE_EMULATOR === "true") {
    connectDatabaseEmulator(firebaseDatabase, "localhost", 9000);
  }

  return firebaseDatabase;
}

/**
 * Get Storage instance
 */
export function getFirebaseStorage(): FirebaseStorage {
  if (firebaseStorage) {
    return firebaseStorage;
  }

  const app = getFirebaseApp();
  firebaseStorage = getStorage(app);

  // Connect to emulator in development if configured
  if (import.meta.env.VITE_USE_FIREBASE_EMULATOR === "true") {
    connectStorageEmulator(firebaseStorage, "localhost", 9199);
  }

  return firebaseStorage;
}

// Export Firebase services for convenience
export const auth = () => getFirebaseAuth();
export const db = () => getFirebaseFirestore();
export const rtdb = () => getFirebaseDatabase();
export const storage = () => getFirebaseStorage();

// Export config for debugging
export { firebaseConfig };

// Default export
export default {
  app: getFirebaseApp,
  auth: getFirebaseAuth,
  db: getFirebaseFirestore,
  database: getFirebaseDatabase,
  storage: getFirebaseStorage,
};
