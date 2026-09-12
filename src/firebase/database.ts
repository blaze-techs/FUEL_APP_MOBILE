/**
 * Firebase Database Helper
 *
 * Provides Firestore and Realtime Database utilities:
 * - CRUD operations
 * - Real-time listeners
 * - Query helpers
 * - Transaction support
 */

import {
  getFirebaseFirestore,
  getFirebaseDatabase,
  getFirebaseApp,
} from "./client";
import {
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
  DocumentData,
  QueryConstraint,
  Firestore,
  FirestoreError,
} from "firebase/firestore";
import {
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
  Database,
  DataSnapshot,
} from "firebase/database";

// Firestore helpers
export const firestore = {
  /**
   * Add a new document to a collection
   */
  async add<T extends DocumentData>(
    collectionPath: string,
    data: Omit<T, "id">,
  ): Promise<string> {
    const db = getFirebaseFirestore();
    const docRef = await addDoc(collection(db, collectionPath), {
      ...data,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return docRef.id;
  },

  /**
   * Set a document (overwrites existing)
   */
  async set<T extends DocumentData>(
    collectionPath: string,
    id: string,
    data: T,
  ): Promise<void> {
    const db = getFirebaseFirestore();
    await setDoc(doc(db, collectionPath, id), {
      ...data,
      updatedAt: serverTimestamp(),
    });
  },

  /**
   * Update a document
   */
  async update<T extends DocumentData>(
    collectionPath: string,
    id: string,
    data: Partial<T>,
  ): Promise<void> {
    const db = getFirebaseFirestore();
    await updateDoc(doc(db, collectionPath, id), {
      ...data,
      updatedAt: serverTimestamp(),
    });
  },

  /**
   * Get a document
   */
  async get<T = DocumentData>(
    collectionPath: string,
    id: string,
  ): Promise<T | null> {
    const db = getFirebaseFirestore();
    const docSnap = await getDoc(doc(db, collectionPath, id));

    if (docSnap.exists()) {
      return { id: docSnap.id, ...docSnap.data() } as T;
    }
    return null;
  },

  /**
   * Get all documents in a collection
   */
  async getAll<T = DocumentData>(
    collectionPath: string,
    ...constraints: QueryConstraint[]
  ): Promise<T[]> {
    const db = getFirebaseFirestore();
    const q = query(collection(db, collectionPath), ...constraints);
    const querySnapshot = await getDocs(q);

    return querySnapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    })) as T[];
  },

  /**
   * Delete a document
   */
  async remove(collectionPath: string, id: string): Promise<void> {
    const db = getFirebaseFirestore();
    await deleteDoc(doc(db, collectionPath, id));
  },

  /**
   * Subscribe to real-time updates
   */
  subscribe<T = DocumentData>(
    collectionPath: string,
    callback: (data: T[]) => void,
    onError?: (error: FirestoreError) => void,
    ...constraints: QueryConstraint[]
  ): () => void {
    const db = getFirebaseFirestore();
    const q = query(collection(db, collectionPath), ...constraints);

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const data = snapshot.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
        })) as T[];
        callback(data);
      },
      (error) => {
        console.error("[Firestore] Subscription error:", error);
        onError?.(error);
      },
    );

    return unsubscribe;
  },

  /**
   * Subscribe to a single document
   */
  subscribeToDoc<T = DocumentData>(
    collectionPath: string,
    id: string,
    callback: (data: T | null) => void,
    onError?: (error: FirestoreError) => void,
  ): () => void {
    const db = getFirebaseFirestore();

    const unsubscribe = onSnapshot(
      doc(db, collectionPath, id),
      (docSnap) => {
        if (docSnap.exists()) {
          callback({ id: docSnap.id, ...docSnap.data() } as T);
        } else {
          callback(null);
        }
      },
      (error) => {
        console.error("[Firestore] Doc subscription error:", error);
        onError?.(error);
      },
    );

    return unsubscribe;
  },
};

// Realtime Database helpers
export const realtimeDb = {
  /**
   * Set data at a path
   */
  async set<T>(path: string, data: T): Promise<void> {
    const db = getFirebaseDatabase();
    await set(ref(db, path), {
      ...data,
      updatedAt: Date.now(),
    });
  },

  /**
   * Push a new child to a list
   */
  async push<T>(path: string, data: T): Promise<string> {
    const db = getFirebaseDatabase();
    const newRef = push(ref(db, path), {
      ...data,
      createdAt: Date.now(),
    });
    return newRef.key || "";
  },

  /**
   * Update specific fields
   */
  async update(path: string, data: Record<string, any>): Promise<void> {
    const db = getFirebaseDatabase();
    await update(ref(db, path), {
      ...data,
      updatedAt: Date.now(),
    });
  },

  /**
   * Remove data at a path
   */
  async remove(path: string): Promise<void> {
    const db = getFirebaseDatabase();
    await remove(ref(db, path));
  },

  /**
   * Get data once
   */
  async get<T = any>(path: string): Promise<T | null> {
    const db = getFirebaseDatabase();
    const snapshot = await get(child(ref(db), path));

    if (snapshot.exists()) {
      return snapshot.val() as T;
    }
    return null;
  },

  /**
   * Subscribe to real-time updates
   */
  subscribe<T = any>(
    path: string,
    callback: (data: T | null) => void,
    onError?: (error: Error) => void,
  ): () => void {
    const db = getFirebaseDatabase();

    const unsubscribe = onValue(
      ref(db, path),
      (snapshot) => {
        if (snapshot.exists()) {
          callback(snapshot.val() as T);
        } else {
          callback(null);
        }
      },
      (error) => {
        console.error("[RealtimeDB] Subscription error:", error);
        onError?.(error);
      },
    );

    return unsubscribe;
  },
};

// Station-specific helpers
export const stations = {
  /**
   * Get station by ID
   */
  async get(stationId: string) {
    return firestore.get("stations", stationId);
  },

  /**
   * Get all stations
   */
  async getAll(ownerId?: string) {
    const constraints: QueryConstraint[] = [orderBy("createdAt", "desc")];
    if (ownerId) {
      constraints.unshift(where("ownerId", "==", ownerId));
    }
    return firestore.getAll("stations", ...constraints);
  },

  /**
   * Create a new station
   */
  async create(data: any) {
    return firestore.add("stations", {
      ...data,
      status: "active",
    });
  },

  /**
   * Update station
   */
  async update(stationId: string, data: any) {
    return firestore.update("stations", stationId, data);
  },

  /**
   * Subscribe to station updates
   */
  subscribe(stationId: string, callback: (data: any) => void) {
    return firestore.subscribeToDoc("stations", stationId, callback);
  },
};

// Sales helpers
export const sales = {
  /**
   * Record a new sale
   */
  async create(data: any) {
    return firestore.add("sales", {
      ...data,
      status: "completed",
    });
  },

  /**
   * Get sales for a station
   */
  async getByStation(stationId: string, limitCount = 50) {
    return firestore.getAll(
      "sales",
      where("stationId", "==", stationId),
      orderBy("createdAt", "desc"),
      limit(limitCount),
    );
  },

  /**
   * Subscribe to live sales
   */
  subscribeToStation(stationId: string, callback: (data: any[]) => void) {
    return firestore.subscribe(
      "sales",
      callback,
      undefined,
      where("stationId", "==", stationId),
      orderBy("createdAt", "desc"),
      limit(50),
    );
  },
};

export default {
  firestore,
  realtimeDb,
  stations,
  sales,
};
