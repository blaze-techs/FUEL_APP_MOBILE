/**
 * Firebase Integration Module
 *
 * Export all Firebase-related functionality for easy importing:
 * - Client SDK for browser-side operations
 * - Admin SDK for server-side operations
 * - Auth helpers
 * - Database helpers
 */

// Re-export client-side Firebase
export {
  getFirebaseApp,
  getFirebaseAuth,
  getFirebaseFirestore,
  getFirebaseDatabase,
  getFirebaseStorage,
  firebaseConfig,
  auth,
  db,
  rtdb,
  storage,
} from "./client";

// Re-export admin-side Firebase (only import in server context!)
export {
  getAdminApp,
  getAdminAuth,
  getAdminFirestore,
  getAdminDatabase,
  getAdminStorage,
  verifyIdToken,
  verifySessionCookie,
  createCustomToken,
  createSessionCookie,
} from "./admin";

// Firebase types
export type { FirebaseApp } from "firebase/app";
export type { Auth } from "firebase/auth";
export type { Firestore } from "firebase/firestore";
export type { Database } from "firebase/database";
export type { FirebaseStorage } from "firebase/storage";

// Re-export Firebase SDK classes for convenience
export { initializeApp, getApps } from "firebase/app";

export {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  GoogleAuthProvider,
  signInWithPopup,
  sendPasswordResetEmail,
  updateProfile,
  getIdToken,
  getIdTokenResult,
} from "firebase/auth";

export {
  collection,
  doc,
  addDoc,
  updateDoc,
  setDoc,
  getDoc,
  getDocs,
  deleteDoc,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
  serverTimestamp,
  Timestamp,
} from "firebase/firestore";

export {
  ref,
  set,
  push,
  update,
  remove,
  onValue,
  get,
  child,
  orderByChild,
  equalTo,
} from "firebase/database";

export {
  ref as storageRef,
  uploadBytes,
  uploadBytesResumable,
  getDownloadURL,
  deleteObject,
} from "firebase/storage";
