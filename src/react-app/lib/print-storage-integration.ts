/**
 * Print & Storage Integration Utilities
 *
 * Provides convenience methods to integrate silent printing and indexed storage
 * throughout the application
 */

import {
  silentPrintService,
  type SilentPrintJob,
  type PrintSettings,
} from "./silent-print-service";
import { indexedStorage, type IndexedStorageStats } from "./indexed-storage";
import { cloudStorage } from "./cloudStorage";
import type { ReceiptData } from "./pos/printer-service";

const cloudSync = cloudStorage;

/**
 * Print Integration API
 */
export const PrintingAPI = {
  /**
   * Print a receipt silently
   */
  async receipt(
    receipt: ReceiptData,
    options?: { printerId?: string; settings?: PrintSettings },
  ): Promise<string> {
    return silentPrintService.queueReceipt(receipt, options?.printerId);
  },

  /**
   * Print a report silently
   */
  async report(
    html: string,
    name: string,
    settings?: PrintSettings,
  ): Promise<string> {
    return silentPrintService.queueReport(html, name);
  },

  /**
   * Print a document silently
   */
  async document(content: any, settings?: PrintSettings): Promise<string> {
    return silentPrintService.queuePrint(content, "document", settings);
  },

  /**
   * Print a label silently
   */
  async label(labelData: any, settings?: PrintSettings): Promise<string> {
    return silentPrintService.queuePrint(labelData, "label", settings);
  },

  /**
   * Get print queue status
   */
  getStatus() {
    return silentPrintService.getQueueStatus();
  },

  /**
   * Get print history
   */
  async getHistory(limit?: number) {
    return silentPrintService.getHistory(limit);
  },

  /**
   * Clear print queue
   */
  clearQueue() {
    silentPrintService.clearQueue();
  },

  /**
   * Retry failed print jobs
   */
  async retryFailed() {
    return silentPrintService.retryFailed();
  },
};

/**
 * Storage Integration API
 */
export const StorageAPI = {
  /**
   * Store data with optional expiry
   */
  async store<T = any>(
    key: string,
    value: T,
    options?: {
      expiresInDays?: number;
      metadata?: Record<string, any>;
      syncImmediately?: boolean;
    },
  ): Promise<void> {
    const expiresAt = options?.expiresInDays
      ? Date.now() + options.expiresInDays * 24 * 60 * 60 * 1000
      : undefined;

    return indexedStorage.set(key, value, {
      expiresAt,
      metadata: options?.metadata,
      syncImmediately: options?.syncImmediately,
    });
  },

  /**
   * Retrieve data from storage
   */
  async retrieve<T = any>(key: string): Promise<T | null> {
    return indexedStorage.get<T>(key);
  },

  /**
   * Store transaction data
   */
  async storeTransaction(transactionId: string, data: any): Promise<void> {
    return this.store(`transaction_${transactionId}`, data, {
      expiresInDays: 90,
      syncImmediately: true,
    });
  },

  /**
   * Retrieve transaction data
   */
  async getTransaction(transactionId: string): Promise<any> {
    return this.retrieve(`transaction_${transactionId}`);
  },

  /**
   * Store station data
   */
  async storeStationData(stationId: string, data: any): Promise<void> {
    return this.store(`station_${stationId}`, data, {
      expiresInDays: 30,
    });
  },

  /**
   * Retrieve station data
   */
  async getStationData(stationId: string): Promise<any> {
    return this.retrieve(`station_${stationId}`);
  },

  /**
   * Store inventory data
   */
  async storeInventory(stationId: string, inventory: any): Promise<void> {
    return this.store(`inventory_${stationId}`, inventory, {
      expiresInDays: 30,
      syncImmediately: true,
    });
  },

  /**
   * Retrieve inventory data
   */
  async getInventory(stationId: string): Promise<any> {
    return this.retrieve(`inventory_${stationId}`);
  },

  /**
   * Store fuel prices
   */
  async storeFuelPrices(prices: Record<string, number>): Promise<void> {
    return this.store("fuel_prices", prices, {
      expiresInDays: 1, // Refresh daily
      syncImmediately: true,
    });
  },

  /**
   * Retrieve fuel prices
   */
  async getFuelPrices(): Promise<Record<string, number> | null> {
    return this.retrieve("fuel_prices");
  },

  /**
   * Store user preferences
   */
  async storeUserPreferences(userId: string, preferences: any): Promise<void> {
    return this.store(`preferences_${userId}`, preferences, {
      expiresInDays: 365,
    });
  },

  /**
   * Retrieve user preferences
   */
  async getUserPreferences(userId: string): Promise<any> {
    return this.retrieve(`preferences_${userId}`);
  },

  /**
   * Get all data matching a prefix
   */
  async getAll(prefix: string): Promise<Record<string, any>> {
    return indexedStorage.getAll(prefix);
  },

  /**
   * Delete stored data
   */
  async remove(key: string): Promise<void> {
    return indexedStorage.delete(key);
  },

  /**
   * Clear all data
   */
  async clear(): Promise<void> {
    return indexedStorage.clear();
  },

  /**
   * Get storage statistics
   */
  async getStats(): Promise<IndexedStorageStats> {
    return indexedStorage.getStats();
  },

  /**
   * Sync pending changes
   */
  async sync(): Promise<boolean> {
    return indexedStorage.syncPendingChanges();
  },
};

/**
 * Offline-First Operations
 */
export const OfflineFirstAPI = {
  /**
   * Execute operation with offline support
   */
  async execute<T>(
    operationName: string,
    operation: () => Promise<T>,
    fallbackData?: T,
  ): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      console.warn(`Operation ${operationName} failed, using fallback`, error);

      if (fallbackData !== undefined) {
        return fallbackData;
      }

      // Try to load from cache
      const cached = await StorageAPI.retrieve(`cache_${operationName}`);
      if (cached) {
        return cached;
      }

      throw error;
    }
  },

  /**
   * Cache operation result
   */
  async cacheResult<T>(
    operationName: string,
    data: T,
    expiresInHours: number = 24,
  ): Promise<void> {
    await StorageAPI.store(`cache_${operationName}`, data, {
      expiresInDays: expiresInHours / 24,
    });
  },

  /**
   * Get cached result
   */
  async getCachedResult<T>(operationName: string): Promise<T | null> {
    return StorageAPI.retrieve(`cache_${operationName}`);
  },

  /**
   * Check if online
   */
  isOnline(): boolean {
    return navigator.onLine;
  },

  /**
   * Check sync status
   */
  async getSyncStatus(): Promise<{
    isOnline: boolean;
    pendingSyncs: number;
    cloudSyncEnabled: boolean;
    lastSync: number | null;
  }> {
    const stats = await StorageAPI.getStats();
    return {
      isOnline: navigator.onLine,
      pendingSyncs: stats.pendingSyncs,
      cloudSyncEnabled: (cloudSync as any).isEnabled(),
      lastSync: stats.lastSync,
    };
  },
};

/**
 * React Hooks for Integration
 */
export const hooks = {
  /**
   * Hook to track print queue status
   */
  usePrintQueue(): {
    pending: number;
    processing: boolean;
    queue: SilentPrintJob[];
  } {
    return PrintingAPI.getStatus();
  },

  /**
   * Hook to track storage stats
   */
  async useStorageStats(): Promise<IndexedStorageStats> {
    return StorageAPI.getStats();
  },

  /**
   * Hook to track sync status
   */
  async useSyncStatus() {
    return OfflineFirstAPI.getSyncStatus();
  },
};

/**
 * Common Use Cases
 */
export const UseCases = {
  /**
   * Process and store a transaction
   */
  async processTransaction(transaction: any): Promise<void> {
    // Store transaction
    await StorageAPI.storeTransaction(transaction.id, transaction);

    // Print receipt silently if receipt data available
    if (transaction.receipt) {
      await PrintingAPI.receipt(transaction.receipt);
    }

    // Sync immediately if online
    if (OfflineFirstAPI.isOnline()) {
      await StorageAPI.sync();
    }
  },

  /**
   * Update inventory with offline support
   */
  async updateInventory(stationId: string, inventory: any): Promise<void> {
    // Store locally first
    await StorageAPI.storeInventory(stationId, inventory);

    // Sync when online
    if (OfflineFirstAPI.isOnline()) {
      await StorageAPI.sync();
    }
  },

  /**
   * Generate and print report
   */
  async generateReport(
    reportData: any,
    options?: { silent?: boolean; autoPrint?: boolean },
  ): Promise<string> {
    const html = this.formatReportHTML(reportData);
    const reportName = `Report_${Date.now()}`;

    // Cache report
    await StorageAPI.store(`report_${reportName}`, { html, data: reportData });

    // Print if auto-print enabled
    if (options?.autoPrint) {
      return PrintingAPI.report(html, reportName);
    }

    return reportName;
  },

  /**
   * Format report HTML (basic template)
   */
  formatReportHTML(data: any): string {
    return `
      <div style="font-family: Arial, sans-serif; padding: 20px;">
        <h1>${data.title || "Report"}</h1>
        <div style="margin: 20px 0;">
          ${Object.entries(data)
            .map(
              ([key, value]) =>
                `<p><strong>${key}:</strong> ${JSON.stringify(value)}</p>`,
            )
            .join("")}
        </div>
        <p style="margin-top: 40px; color: #666; font-size: 12px;">
          Generated on ${new Date().toLocaleString()}
        </p>
      </div>
    `;
  },

  /**
   * Bulk store data
   */
  async bulkStore(data: Record<string, any>): Promise<void> {
    const promises = Object.entries(data).map(([key, value]) =>
      StorageAPI.store(key, value),
    );
    await Promise.all(promises);
  },

  /**
   * Bulk retrieve data
   */
  async bulkRetrieve(keys: string[]): Promise<Record<string, any>> {
    const results: Record<string, any> = {};
    for (const key of keys) {
      results[key] = await StorageAPI.retrieve(key);
    }
    return results;
  },
};

// Initialize on module load
if (typeof window !== "undefined") {
  // Make APIs available globally for debugging
  (window as any).FuelProPrinting = PrintingAPI;
  (window as any).FuelProStorage = StorageAPI;
  (window as any).FuelProOfflineFirst = OfflineFirstAPI;
}

export default {
  PrintingAPI,
  StorageAPI,
  OfflineFirstAPI,
  UseCases,
  hooks,
};
