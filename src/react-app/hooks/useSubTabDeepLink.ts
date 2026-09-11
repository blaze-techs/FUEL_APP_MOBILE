/**
 * useSubTabDeepLink — generic sub-tab deep-link handler.
 *
 * Hosts with a SubTabBar call this once; QuickSearch / AIChatbot (or any
 * navigateToSubTab caller) can then jump straight into a specific sub-tab.
 * Also supports extra payload handling (e.g. News receives a movie search
 * query) via a generic payload object.
 *
 * Payload shape: { subTab?: string; ...extras } — `subTab` is applied to the
 * host's active-sub-tab setter; extras are forwarded to the optional handler.
 */

import { useEffect, type Dispatch, type SetStateAction } from "react";
import { onTabPayload } from "@/react-app/lib/mpesa-integration-service";

export interface SubTabPayload {
  subTab?: string;
  [key: string]: unknown;
}

export function useSubTabDeepLink<T extends string>(
  tabId: string,
  setSubTab: Dispatch<SetStateAction<T>>,
  onExtra?: (payload: SubTabPayload) => void,
): void {
  useEffect(
    () =>
      onTabPayload(tabId, (p: unknown) => {
        const payload = (p || {}) as SubTabPayload;
        if (payload.subTab) setSubTab(payload.subTab as T);
        if (onExtra) onExtra(payload);
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tabId, onExtra],
  );
}
