  //    their role, access method, assigned pumps/shifts, audit log, and the
  //    quick actions (extend, revoke, enable/disable) in one place.
  const [drawerMemberId, setDrawerMemberId] = useState<string | null>(null);

  // ── Live connectivity status ─────────────────────────────────────────
  // navigator.onLine is the only source used for the "Offline" label. A
  // backend/RLS/Realtime error must NOT be mislabeled as an internet outage.
  // Keep the last known roster in memory while offline; reconnect simply
  // rehydrates from the authoritative cloud source and never fabricates rows.
  const [syncOnline, setSyncOnline] = useState(() =>
    typeof navigator === "undefined" ? true : navigator.onLine,
  );
    useEffect(() => {
    const markOnline = () => {
       setSyncOnline(true);
      // Re-fetch immediately after reconnect; existing rendered data is kept
      // intact until the authoritative response arrives.
      setRosterRefreshNonce((n) => n + 1);
    };
    const markOffline = () => {
      setSyncOnline(false);
    };

    // Do not use fetch failures, RLS errors, or Realtime status as a proxy for
    // internet connectivity. Those are backend/service states, not network
    // state, and must be reported separately.
    setSyncOnline(
      typeof navigator === "undefined" ? true : navigator.onLine,
    );
    window.addEventListener("online", markOnline);
    window.addEventListener("offline", markOffline);

    return () => {
      window.removeEventListener("online", markOnline);
      window.removeEventListener("offline", markOffline);
    };
  }, []);
