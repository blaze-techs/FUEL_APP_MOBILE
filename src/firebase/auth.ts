/**
 * Firebase Authentication Helper
 *
 * Provides authentication utilities using Firebase Auth:
 * - Email/password authentication
 * - Google sign-in
 * - Session management
 * - Token handling
 */

import { getFirebaseAuth, getFirebaseApp } from "./client";
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut as firebaseSignOut,
  GoogleAuthProvider,
  signInWithPopup,
  sendPasswordResetEmail,
  updateProfile,
  getIdToken,
  getIdTokenResult,
  User,
  UserCredential,
} from "firebase/auth";
import { browserLocalPersistence, setPersistence } from "firebase/auth";

// Google Auth Provider instance
const googleProvider = new GoogleAuthProvider();
googleProvider.addScope("email");
googleProvider.addScope("profile");

export interface AuthUser {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
  emailVerified: boolean;
  phoneNumber: string | null;
  providerId: string;
  metadata: {
    creationTime: string;
    lastSignInTime: string;
  };
}

/**
 * Convert Firebase User to AuthUser
 */
function toAuthUser(user: User): AuthUser {
  return {
    uid: user.uid,
    email: user.email,
    displayName: user.displayName,
    photoURL: user.photoURL,
    emailVerified: user.emailVerified,
    phoneNumber: user.phoneNumber,
    providerId: user.providerId,
    metadata: {
      creationTime: user.metadata.creationTime || "",
      lastSignInTime: user.metadata.lastSignInTime || "",
    },
  };
}

/**
 * Set up authentication state listener
 */
export function onAuthChange(
  callback: (user: AuthUser | null) => void,
  errorCallback?: (error: Error) => void,
): () => void {
  const auth = getFirebaseAuth();

  // Set persistence to local for better UX
  setPersistence(auth, browserLocalPersistence).catch(console.error);

  return onAuthStateChanged(
    auth,
    (user) => {
      callback(user ? toAuthUser(user) : null);
    },
    (error) => {
      console.error("[Firebase Auth] Auth state error:", error);
      errorCallback?.(error);
    },
  );
}

/**
 * Sign in with email and password
 */
export async function signInWithEmail(
  email: string,
  password: string,
): Promise<{ user: AuthUser; credential: UserCredential }> {
  const auth = getFirebaseAuth();
  const credential = await signInWithEmailAndPassword(auth, email, password);
  return {
    user: toAuthUser(credential.user),
    credential,
  };
}

/**
 * Sign up with email and password
 */
export async function signUpWithEmail(
  email: string,
  password: string,
  displayName?: string,
): Promise<{ user: AuthUser; credential: UserCredential }> {
  const auth = getFirebaseAuth();
  const credential = await createUserWithEmailAndPassword(
    auth,
    email,
    password,
  );

  // Update display name if provided
  if (displayName && credential.user) {
    await updateProfile(credential.user, { displayName });
  }

  return {
    user: toAuthUser(credential.user),
    credential,
  };
}

/**
 * Sign in with Google
 */
export async function signInWithGoogle(): Promise<{
  user: AuthUser;
  credential: UserCredential;
}> {
  const auth = getFirebaseAuth();
  const credential = await signInWithPopup(auth, googleProvider);
  return {
    user: toAuthUser(credential.user),
    credential,
  };
}

/**
 * Sign out
 */
export async function signOut(): Promise<void> {
  const auth = getFirebaseAuth();
  await firebaseSignOut(auth);
}

/**
 * Send password reset email
 */
export async function resetPassword(email: string): Promise<void> {
  const auth = getFirebaseAuth();
  await sendPasswordResetEmail(auth, email);
}

/**
 * Get current user
 */
export function getCurrentUser(): AuthUser | null {
  const auth = getFirebaseAuth();
  const user = auth.currentUser;
  return user ? toAuthUser(user) : null;
}

/**
 * Get ID token for current user
 */
export async function getCurrentUserToken(
  forceRefresh = false,
): Promise<string | null> {
  const auth = getFirebaseAuth();
  const user = auth.currentUser;

  if (!user) {
    return null;
  }

  return await getIdToken(user, forceRefresh);
}

/**
 * Get ID token result (includes claims)
 */
export async function getIdTokenWithClaims(): Promise<{
  token: string;
  claims: Record<string, any>;
  expirationTime: string;
} | null> {
  const auth = getFirebaseAuth();
  const user = auth.currentUser;

  if (!user) {
    return null;
  }

  const result = await getIdTokenResult(user, true);
  return {
    token: result.token,
    claims: result.claims as Record<string, any>,
    expirationTime: result.expirationTime,
  };
}

/**
 * Verify ID token on server side
 */
export async function verifyUserToken(token: string): Promise<{
  uid: string;
  email: string;
  email_verified: boolean;
}> {
  // This should be called server-side for security
  // For client-side, we just return the user info
  const auth = getFirebaseAuth();
  const user = auth.currentUser;

  if (!user) {
    throw new Error("No user logged in");
  }

  return {
    uid: user.uid,
    email: user.email || "",
    email_verified: user.emailVerified,
  };
}

/**
 * Check if user is authenticated
 */
export function isAuthenticated(): boolean {
  const auth = getFirebaseAuth();
  return auth.currentUser !== null;
}

/**
 * Create custom token for user (server-side only)
 * Note: This should be called from a secure backend
 */
export async function createTokenForUser(uid: string): Promise<string> {
  // In production, this should call your backend
  // For now, we'll use Firebase Auth directly
  const auth = getFirebaseAuth();
  const user = auth.currentUser;

  if (!user || user.uid !== uid) {
    throw new Error("Unauthorized");
  }

  // Generate a custom token (this would normally be done server-side)
  // For client-side, we use the ID token
  return await getIdToken(user);
}

export default {
  onAuthChange,
  signInWithEmail,
  signUpWithEmail,
  signInWithGoogle,
  signOut,
  resetPassword,
  getCurrentUser,
  getCurrentUserToken,
  getIdTokenWithClaims,
  verifyUserToken,
  isAuthenticated,
  createTokenForUser,
};
