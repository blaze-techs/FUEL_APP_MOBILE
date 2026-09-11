/**
 * IndexedDB Database using Dexie.js
 * Replaces localStorage for scalable, offline-first data storage
 */

import Dexie, { Table } from "dexie";

// Types
export interface Sale {
  id?: number;
  date: string;
  amount: number;
  fuelType: string;
  liters: number;
  pricePerLiter: number;
  paymentMethod: "cash" | "mpesa" | "card";
  mpesaReceipt?: string;
  attendantId: string;
  attendantName: string;
  stationId: string;
  customerPhone?: string;
  status: "pending" | "paid" | "failed";
  synced: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface InventoryItem {
  id?: number;
  itemName: string;
  category: "fuel" | "lubricant" | "accessory" | "other";
  quantity: number;
  unit: string;
  unitPrice: number;
  reorderLevel: number;
  supplier?: string;
  lastUpdated: string;
  synced: boolean;
}

export interface Employee {
  id?: number;
  name: string;
  email: string;
  phone: string;
  role: "owner" | "manager" | "attendant" | "security";
  status: "active" | "inactive";
  hireDate: string;
  salary?: number;
  stationId: string;
  synced: boolean;
}

export interface Expense {
  id?: number;
  date: string;
  category:
    "fuel" | "salary" | "maintenance" | "utilities" | "supplies" | "other";
  amount: number;
  description: string;
  receipt?: string;
  stationId: string;
  createdBy: string;
  synced: boolean;
  createdAt: string;
}

export interface Station {
  id?: number;
  name: string;
  location: string;
  latitude?: number;
  longitude?: number;
  managerId?: string;
  openingHours?: string;
  status: "active" | "inactive";
  synced: boolean;
}

export interface Settings {
  key: string;
  value: any;
}

export interface SyncQueue {
  id?: number;
  table: string;
  operation: "add" | "update" | "delete";
  data: any;
  timestamp: string;
  retries: number;
}

// Database Class
class FuelProDatabase extends Dexie {
  sales!: Table<Sale>;
  inventory!: Table<InventoryItem>;
  employees!: Table<Employee>;
  expenses!: Table<Expense>;
  stations!: Table<Station>;
  settings!: Table<Settings>;
  syncQueue!: Table<SyncQueue>;

  constructor() {
    super("FuelProDatabase");

    this.version(1).stores({
      sales:
        "++id, date, fuelType, paymentMethod, attendantId, stationId, status, synced, createdAt",
      inventory: "++id, itemName, category, synced",
      employees: "++id, email, phone, role, stationId, status, synced",
      expenses: "++id, date, category, stationId, synced, createdAt",
      stations: "++id, name, status, synced",
      settings: "key",
      syncQueue: "++id, table, operation, timestamp",
    });
  }
}

// Create singleton instance
export const db = new FuelProDatabase();

// Migration from localStorage
export async function migrateFromLocalStorage(): Promise<void> {
  const hasMigrated = localStorage.getItem("fuelpro_migrated_to_idb");
  if (hasMigrated) return;

  console.log("🔄 Migrating data from localStorage to IndexedDB...");

  try {
    const salesData = localStorage.getItem("fuelpro_sales");
    if (salesData) {
      const sales = JSON.parse(salesData);
      if (Array.isArray(sales) && sales.length > 0) {
        await db.sales.bulkAdd(sales.map((s) => ({ ...s, synced: false })));
        console.log(`✅ Migrated ${sales.length} sales records`);
      }
    }

    const inventoryData = localStorage.getItem("fuelpro_inventory");
    if (inventoryData) {
      const inventory = JSON.parse(inventoryData);
      if (Array.isArray(inventory) && inventory.length > 0) {
        await db.inventory.bulkAdd(
          inventory.map((i) => ({ ...i, synced: false })),
        );
        console.log(`✅ Migrated ${inventory.length} inventory items`);
      }
    }

    const employeesData = localStorage.getItem("fuelpro_employees");
    if (employeesData) {
      const employees = JSON.parse(employeesData);
      if (Array.isArray(employees) && employees.length > 0) {
        await db.employees.bulkAdd(
          employees.map((e) => ({ ...e, synced: false })),
        );
        console.log(`✅ Migrated ${employees.length} employees`);
      }
    }

    const expensesData = localStorage.getItem("fuelpro_expenses");
    if (expensesData) {
      const expenses = JSON.parse(expensesData);
      if (Array.isArray(expenses) && expenses.length > 0) {
        await db.expenses.bulkAdd(
          expenses.map((e) => ({ ...e, synced: false })),
        );
        console.log(`✅ Migrated ${expenses.length} expense records`);
      }
    }

    const settingsData = localStorage.getItem("fuelpro_settings");
    if (settingsData) {
      const settings = JSON.parse(settingsData);
      for (const [key, value] of Object.entries(settings)) {
        await db.settings.put({ key, value });
      }
      console.log("✅ Migrated settings");
    }

    localStorage.setItem("fuelpro_migrated_to_idb", "true");
    console.log("✅ Migration complete!");
  } catch (error) {
    console.error("❌ Migration failed:", error);
  }
}

// Sales operations
export const salesDb = {
  async add(sale: Omit<Sale, "id">): Promise<number> {
    const id = await db.sales.add(sale as Sale);
    await addToSyncQueue("sales", "add", sale);
    return id;
  },

  async update(id: number, updates: Partial<Sale>): Promise<void> {
    await db.sales.update(id, {
      ...updates,
      updatedAt: new Date().toISOString(),
    });
    await addToSyncQueue("sales", "update", { id, ...updates });
  },

  async delete(id: number): Promise<void> {
    await db.sales.delete(id);
    await addToSyncQueue("sales", "delete", { id });
  },

  async getAll(stationId?: string): Promise<Sale[]> {
    if (stationId) {
      return db.sales.where("stationId").equals(stationId).toArray();
    }
    return db.sales.toArray();
  },

  async getByDateRange(startDate: string, endDate: string): Promise<Sale[]> {
    return db.sales.where("date").between(startDate, endDate).toArray();
  },

  async getUnsynced(): Promise<Sale[]> {
    return db.sales.filter((s) => !s.synced).toArray();
  },

  async markSynced(ids: number[]): Promise<void> {
    await Promise.all(ids.map((id) => db.sales.update(id, { synced: true })));
  },
};

// Inventory operations
export const inventoryDb = {
  async add(item: Omit<InventoryItem, "id">): Promise<number> {
    const id = await db.inventory.add(item as InventoryItem);
    await addToSyncQueue("inventory", "add", item);
    return id;
  },

  async update(id: number, updates: Partial<InventoryItem>): Promise<void> {
    await db.inventory.update(id, {
      ...updates,
      lastUpdated: new Date().toISOString(),
    });
    await addToSyncQueue("inventory", "update", { id, ...updates });
  },

  async getLowStock(): Promise<InventoryItem[]> {
    const all = await db.inventory.toArray();
    return all.filter((item) => item.quantity <= item.reorderLevel);
  },

  async getAll(): Promise<InventoryItem[]> {
    return db.inventory.toArray();
  },
};

// Employees operations
export const employeesDb = {
  async add(employee: Omit<Employee, "id">): Promise<number> {
    const id = await db.employees.add(employee as Employee);
    await addToSyncQueue("employees", "add", employee);
    return id;
  },

  async update(id: number, updates: Partial<Employee>): Promise<void> {
    await db.employees.update(id, updates);
    await addToSyncQueue("employees", "update", { id, ...updates });
  },

  async getByRole(role: string): Promise<Employee[]> {
    return db.employees.where("role").equals(role).toArray();
  },

  async getAll(): Promise<Employee[]> {
    return db.employees.toArray();
  },
};

// Expenses operations
export const expensesDb = {
  async add(expense: Omit<Expense, "id">): Promise<number> {
    const id = await db.expenses.add(expense as Expense);
    await addToSyncQueue("expenses", "add", expense);
    return id;
  },

  async getByCategory(category: string): Promise<Expense[]> {
    return db.expenses.where("category").equals(category).toArray();
  },

  async getAll(): Promise<Expense[]> {
    return db.expenses.toArray();
  },
};

// Settings operations
export const settingsDb = {
  async get(key: string): Promise<any> {
    const setting = await db.settings.get(key);
    return setting?.value;
  },

  async set(key: string, value: any): Promise<void> {
    await db.settings.put({ key, value });
  },

  async getAll(): Promise<Record<string, any>> {
    const settings = await db.settings.toArray();
    return settings.reduce((acc, s) => ({ ...acc, [s.key]: s.value }), {});
  },
};

// Sync queue operations
async function addToSyncQueue(
  table: string,
  operation: "add" | "update" | "delete",
  data: any,
): Promise<void> {
  await db.syncQueue.add({
    table,
    operation,
    data,
    timestamp: new Date().toISOString(),
    retries: 0,
  });
}

export async function processSyncQueue(apiBaseUrl: string): Promise<void> {
  const queue = await db.syncQueue.toArray();

  for (const item of queue) {
    try {
      const endpoint = `${apiBaseUrl}/api/${item.table}`;
      const method =
        item.operation === "add"
          ? "POST"
          : item.operation === "update"
            ? "PUT"
            : "DELETE";

      const response = await fetch(endpoint, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(item.data),
      });

      if (response.ok) {
        await db.syncQueue.delete(item.id!);
      } else if (response.status >= 500) {
        await db.syncQueue.update(item.id!, { retries: item.retries + 1 });
      }
    } catch (error) {
      console.error(`Sync error for ${item.table}:`, error);
    }
  }
}

export default db;
