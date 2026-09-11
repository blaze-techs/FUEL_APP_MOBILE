/**
 * Firebase Admin SDK Configuration
 *
 * This file configures Firebase Admin SDK for server-side operations.
 * Used for:
 * - Token verification
 * - Admin database operations
 * - User management
 * - Cloud Functions
 *
 * IMPORTANT: This file should only be used in backend/server contexts.
 * Never expose Firebase Admin credentials in client-side code.
 */

import * as admin from "firebase-admin";

// Firebase Admin configuration from environment variables
const firebaseAdminConfig: admin.ServiceAccount = {
  projectId: process.env.FIREBASE_PROJECT_ID || "fuel-pro-1",
  privateKey: (process.env.FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, "\n"),
  clientEmail:
    process.env.FIREBASE_CLIENT_EMAIL ||
    "firebase-adminsdk-fbsvc@fuel-pro-1.iam.gserviceaccount.com",
};

// Initialize Firebase Admin (singleton pattern)
let adminApp: admin.app.App | null = null;

export function getAdminApp(): admin.app.App {
  if (adminApp) {
    return adminApp;
  }

  // Check if Firebase Admin is already initialized
  if (admin.apps.length > 0) {
    adminApp = admin.apps[0]!;
    return adminApp;
  }

  try {
    // Initialize with service account
    if (
      firebaseAdminConfig.projectId &&
      firebaseAdminConfig.privateKey &&
      firebaseAdminConfig.clientEmail
    ) {
      adminApp = admin.initializeApp({
        credential: admin.credential.cert(firebaseAdminConfig),
        databaseURL:
          process.env.FIREBASE_DATABASE_URL ||
          "https://fuel-pro-1.firebaseio.com",
      });
    } else {
      // Fallback: Initialize without credentials for development
      console.warn(
        "[Firebase Admin] Missing credentials, initializing with default config",
      );
      adminApp = admin.initializeApp({
        projectId: "fuel-pro-1",
      });
    }

    return adminApp;
  } catch (error) {
    console.error("[Firebase Admin] Failed to initialize:", error);
    throw error;
  }
}

// Export commonly used Firebase Admin services
export const getAdminAuth = (): admin.auth.Auth => {
  return getAdminApp().auth();
};

export const getAdminFirestore = (): admin.firestore.Firestore => {
  return getAdminApp().firestore();
};

export const getAdminDatabase = (): admin.database.Database => {
  return getAdminApp().database();
};

export const getAdminStorage = (): admin.storage.Storage => {
  return getAdminApp().storage();
};

// Verify Firebase ID token
export async function verifyIdToken(
  idToken: string,
): Promise<admin.auth.DecodedIdToken> {
  try {
    const auth = getAdminAuth();
    return await auth.verifyIdToken(idToken);
  } catch (error) {
    console.error("[Firebase Admin] Token verification failed:", error);
    throw error;
  }
}

// Verify session cookie
export async function verifySessionCookie(
  sessionCookie: string,
): Promise<admin.auth.UserRecord> {
  try {
    const auth = getAdminAuth();
    return await auth.verifySessionCookie(sessionCookie, true);
  } catch (error) {
    console.error("[Firebase Admin] Session verification failed:", error);
    throw error;
  }
}

// Create custom token for user
export async function createCustomToken(
  uid: string,
  additionalClaims?: Record<string, any>,
): Promise<string> {
  try {
    const auth = getAdminAuth();
    return await auth.createCustomToken(uid, additionalClaims);
  } catch (error) {
    console.error("[Firebase Admin] Custom token creation failed:", error);
    throw error;
  }
}

// Create session cookie
export async function createSessionCookie(
  idToken: string,
  expiresIn: number = 5 * 24 * 60 * 60 * 1000,
): Promise<string> {
  try {
    const auth = getAdminAuth();
    return await auth.createSessionCookie(idToken, { expiresIn });
  } catch (error) {
    console.error("[Firebase Admin] Session cookie creation failed:", error);
    throw error;
  }
}

// Export the admin instance for direct access
export default getAdminApp;
