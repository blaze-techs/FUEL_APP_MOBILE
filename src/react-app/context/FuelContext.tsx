
  // ------------------------------------------------------------
  // syncPriceToFuelTypes: write a FuelContext price change back into
  // fuel_types_config (so FuelTypesManager/PriceBoard/POS/Invoice/Reports see
  // it) and broadcast on the interlink bus. Exposed via context for any
  // component that edits a station pump price.
  const syncPriceToFuelTypes = useCallback(
    (
      raw: string,
      price: number,
      changedBy?: string,
      source?: "user" | "scheduled" | "auto",
    ) => {
      if (typeof price !== "number" || !isFinite(price) || price <= 0) return;
      // Automatic/regulator writes are retired. Reference prices may still be
      // displayed by advisory tools, but they are never allowed to mutate the
      // station's operational selling price.
      if (source === "auto") return;
      const canonical = normalizeFuelType(raw);
      if (!canonical) return;
      // Update the matching fuel_types_config entry (if any) and persist.
      // `source` records WHO set this price so the regulator auto-sync never
      // overwrites an explicit user/scheduled price (pricing stability).
      // Every direct caller of syncPriceToFuelTypes is an explicit price-set
      // action (PriceBoard save, DeliveryTracker input, "Set as my price"),
      // so the default is "user" — only the Price Scheduler passes
      // "scheduled", and the regulator passes "auto".
      const effectiveSource = source ?? "user";
      const list = fuelTypesRef.current;
      let oldPrice: number | null = null;
      if (list.length > 0) {
        const idx = list.findIndex(
          (ft) => normalizeFuelType(ft.name) === canonical,
        );
        if (idx >= 0 && list[idx].price !== price) {
          oldPrice = list[idx].price ?? null;
          const next = list.slice();
          next[idx] = { ...next[idx], price, source: effectiveSource };
          fuelTypesRef.current = next;
          cloudStorageService
            .set("fuel_types_config", next, stationIdRef.current)
            .catch(() => {});
        }
      }
      // Record the change in the shared price-history trail so Rate History
      // (and the whole Fuel Type Manager matrix) sees changes from EVERY
      // source — Price Board, Price Scheduler, Dashboard, Fuel Price Finder.
      // Deduped inside recordPriceChange so double-callers don't double-log.
      if (oldPrice !== null && oldPrice !== price) {
        void recordPriceChange({