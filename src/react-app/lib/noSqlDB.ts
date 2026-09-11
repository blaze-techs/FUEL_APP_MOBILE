/**
 * FuelPro NoSQL Database (IndexedDB)
 * Client-side document store with offline-first capability
 */

import React, { useState, useEffect } from "react";

interface Document<T = any> {
  id: string;
  _rev?: string;
  _createdAt: number;
  _updatedAt: number;
  _deleted?: boolean;
  data: T;
}

interface QueryOptions {
  limit?: number;
  skip?: number;
  sort?: { field: string; order: "asc" | "desc" };
  filter?: (doc: Document) => boolean;
  includeDeleted?: boolean;
}

class NoSQLDB {
  private db: IDBDatabase | null = null;
  private dbName: string;
  private version: number;
  private ready: Promise<void>;

  constructor(dbName: string = "fuelpro_nosql", version: number = 1) {
    this.dbName = dbName;
    this.version = version;
    this.ready = this.init();
  }

  private async init(): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.version);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this.db = request.result;
        resolve();
      };

      request.onupgradeneeded = (e) => {
        const db = (e.target as IDBOpenDBRequest).result;

        // Create collections (object stores)
        const collections = [
          "users",
          "stations",
          "sales",
          "inventory",
          "products",
          "expenses",
          "coupons",
          "mpesa_transactions",
          "sync_queue",
          "files",
          "cache",
        ];

        collections.forEach((name) => {
          if (!db.objectStoreNames.contains(name)) {
            const store = db.createObjectStore(name, { keyPath: "id" });
            store.createIndex("_updatedAt", "_updatedAt", { unique: false });
            store.createIndex("_deleted", "_deleted", { unique: false });
          }
        });
      };
    });
  }

  async ensureReady() {
    await this.ready;
  }

  private async getStore(
    collection: string,
    mode: IDBTransactionMode = "readonly",
  ): Promise<IDBObjectStore> {
    await this.ensureReady();
    if (!this.db) throw new Error("Database not initialized");
    const tx = this.db.transaction(collection, mode);
    return tx.objectStore(collection);
  }

  // ─── CRUD Operations ───

  async insert<T>(
    collection: string,
    data: T,
    id?: string,
  ): Promise<Document<T>> {
    const docId =
      id || `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    const now = Date.now();

    const doc: Document<T> = {
      id: docId,
      _rev: this.generateRev(),
      _createdAt: now,
      _updatedAt: now,
      data,
    };

    const store = await this.getStore(collection, "readwrite");

    return new Promise((resolve, reject) => {
      const request = store.add(doc);
      request.onsuccess = () => resolve(doc);
      request.onerror = () => reject(request.error);
    });
  }

  async upsert<T>(
    collection: string,
    id: string,
    data: T,
  ): Promise<Document<T>> {
    const existing = await this.get<T>(collection, id);
    const now = Date.now();

    const doc: Document<T> = existing
      ? { ...existing, data, _updatedAt: now, _rev: this.generateRev() }
      : {
          id,
          _rev: this.generateRev(),
          _createdAt: now,
          _updatedAt: now,
          data,
        };

    const store = await this.getStore(collection, "readwrite");

    return new Promise((resolve, reject) => {
      const request = store.put(doc);
      request.onsuccess = () => resolve(doc);
      request.onerror = () => reject(request.error);
    });
  }

  async get<T>(collection: string, id: string): Promise<Document<T> | null> {
    const store = await this.getStore(collection);

    return new Promise((resolve, reject) => {
      const request = store.get(id);
      request.onsuccess = () => {
        const doc = request.result as Document<T>;
        if (doc && !doc._deleted) {
          resolve(doc);
        } else {
          resolve(null);
        }
      };
      request.onerror = () => reject(request.error);
    });
  }

  async getAll<T>(
    collection: string,
    options: QueryOptions = {},
  ): Promise<Document<T>[]> {
    const store = await this.getStore(collection);
    const {
      limit = 1000,
      skip = 0,
      sort,
      filter,
      includeDeleted = false,
    } = options;

    return new Promise((resolve, reject) => {
      const request = store.getAll();
      request.onsuccess = () => {
        let docs = request.result as Document<T>[];

        // Filter deleted
        if (!includeDeleted) {
          docs = docs.filter((d) => !d._deleted);
        }

        // Apply custom filter
        if (filter) {
          docs = docs.filter(filter);
        }

        // Sort
        if (sort) {
          docs.sort((a, b) => {
            const aVal =
              (a.data as any)[sort.field] || a[sort.field as keyof Document];
            const bVal =
              (b.data as any)[sort.field] || b[sort.field as keyof Document];
            const cmp = aVal < bVal ? -1 : aVal > bVal ? 1 : 0;
            return sort.order === "desc" ? -cmp : cmp;
          });
        } else {
          // Default sort by updatedAt desc
          docs.sort((a, b) => b._updatedAt - a._updatedAt);
        }

        // Pagination
        docs = docs.slice(skip, skip + limit);

        resolve(docs);
      };
      request.onerror = () => reject(request.error);
    });
  }

  async find<T>(
    collection: string,
    predicate: (doc: Document<T>) => boolean,
  ): Promise<Document<T>[]> {
    const docs = await this.getAll<T>(collection);
    return docs.filter(predicate);
  }

  async delete(collection: string, id: string, soft = true): Promise<void> {
    if (soft) {
      // Soft delete
      const doc = await this.get(collection, id);
      if (doc) {
        await this.upsert(collection, id, doc.data);
        const store = await this.getStore(collection, "readwrite");
        return new Promise((resolve, reject) => {
          doc!._deleted = true;
          const request = store.put(doc);
          request.onsuccess = () => resolve();
          request.onerror = () => reject(request.error);
        });
      }
    } else {
      // Hard delete
      const store = await this.getStore(collection, "readwrite");
      return new Promise((resolve, reject) => {
        const request = store.delete(id);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
    }
  }

  // ─── Query Helpers ───

  async count(collection: string): Promise<number> {
    const docs = await this.getAll(collection);
    return docs.length;
  }

  async exists(collection: string, id: string): Promise<boolean> {
    const doc = await this.get(collection, id);
    return doc !== null;
  }

  // ─── Bulk Operations ───

  async bulkInsert<T>(collection: string, items: T[]): Promise<Document<T>[]> {
    const results: Document<T>[] = [];
    for (const item of items) {
      const doc = await this.insert(collection, item);
      results.push(doc);
    }
    return results;
  }

  async bulkUpsert<T>(
    collection: string,
    items: { id: string; data: T }[],
  ): Promise<Document<T>[]> {
    const results: Document<T>[] = [];
    for (const item of items) {
      const doc = await this.upsert(collection, item.id, item.data);
      results.push(doc);
    }
    return results;
  }

  // ─── Maintenance ───

  async clear(collection: string): Promise<void> {
    const store = await this.getStore(collection, "readwrite");
    return new Promise((resolve, reject) => {
      const request = store.clear();
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async compact(collection: string): Promise<number> {
    // Remove soft-deleted documents
    const docs = await this.getAll(collection, { includeDeleted: true });
    let removed = 0;

    for (const doc of docs) {
      if (doc._deleted) {
        await this.delete(collection, doc.id, false);
        removed++;
      }
    }

    return removed;
  }

  async exportAll(): Promise<Record<string, Document[]>> {
    const storeNames = Array.from(this.db?.objectStoreNames || []);
    const result: Record<string, Document[]> = {};

    for (const name of storeNames) {
      result[name] = await this.getAll(name, { includeDeleted: true });
    }

    return result;
  }

  async importAll(data: Record<string, Document[]>): Promise<void> {
    for (const [collection, docs] of Object.entries(data)) {
      for (const doc of docs) {
        try {
          await this.upsert(collection, doc.id, doc.data);
        } catch {
          /* Skip duplicates */
        }
      }
    }
  }

  // ─── Utilities ───

  private generateRev(): string {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  }

  async getStats(): Promise<Record<string, { count: number; size: number }>> {
    const storeNames = Array.from(this.db?.objectStoreNames || []);
    const stats: Record<string, { count: number; size: number }> = {};

    for (const name of storeNames) {
      const docs = await this.getAll(name);
      const size = new Blob([JSON.stringify(docs)]).size;
      stats[name] = { count: docs.length, size };
    }

    return stats;
  }
}

// ─── Singleton Instance ───
export const nosqlDB = new NoSQLDB();

// ─── React Hook ───
export function useNoSQL<T>(collection: string) {
  const [data, setData] = useState<Document<T>[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    nosqlDB.ensureReady().then(async () => {
      try {
        const docs = await nosqlDB.getAll<T>(collection);
        setData(docs);
      } catch (e) {
        setError(e as Error);
      } finally {
        setLoading(false);
      }
    });
  }, [collection]);

  const insert = async (item: T, id?: string) => {
    const doc = await nosqlDB.insert(collection, item, id);
    setData((prev) => [doc, ...prev]);
    return doc;
  };

  const update = async (id: string, item: T) => {
    const doc = await nosqlDB.upsert(collection, id, item);
    setData((prev) => prev.map((d) => (d.id === id ? doc : d)));
    return doc;
  };

  const remove = async (id: string) => {
    await nosqlDB.delete(collection, id);
    setData((prev) => prev.filter((d) => d.id !== id));
  };

  return { data, loading, error, insert, update, remove, refresh: () => {} };
}

export { NoSQLDB };
export default NoSQLDB;
