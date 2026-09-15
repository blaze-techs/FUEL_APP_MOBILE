/**
 * agreements-service — FuelPro Agreements (contracts + e-signature).
 *
 * Reverse-engineered from Reatech360's `/admin/agreements`:
 *   - Create a contract/agreement (title, client/signer name, email,
 *     terms text, start/end dates)
 *   - Status lifecycle: draft → sent → signed (signer name + signed_at)
 *   - Send for signature; "sign" records the signer + timestamp
 *   - Track history (sent_at, sent_by, signed_at)
 *
 * Persisted station-scoped to app_kv via cloudStorageService, matching
 * the app-wide cloud-first pattern. Extendible to real e-signature
 * vendors later.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import cloudStorageService from "@/react-app/lib/cloud-storage-service";

export const AGREEMENTS_KEY = "agreements";

export type AgreementStatus = "draft" | "sent" | "signed";

export interface Agreement {
  id: string;
  title: string;
  clientName: string;
  clientEmail: string;
  terms: string;
  startDate: string | null;
  endDate: string | null;
  status: AgreementStatus;
  signerName: string | null;
  signedAt: string | null;
  sentAt: string | null;
  sentBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export function normalizeAgreements(v: unknown): Agreement[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((a) => a && typeof a === "object")
    .map((a) => {
      const o = a as Partial<Agreement>;
      return {
        id:
          typeof o.id === "string"
            ? o.id
            : `agr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        title: typeof o.title === "string" ? o.title : "Untitled agreement",
        clientName: typeof o.clientName === "string" ? o.clientName : "",
        clientEmail: typeof o.clientEmail === "string" ? o.clientEmail : "",
        terms: typeof o.terms === "string" ? o.terms : "",
        startDate: typeof o.startDate === "string" ? o.startDate : null,
        endDate: typeof o.endDate === "string" ? o.endDate : null,
        status: ["draft", "sent", "signed"].includes(o.status as string)
          ? (o.status as AgreementStatus)
          : "draft",
        signerName: typeof o.signerName === "string" ? o.signerName : null,
        signedAt: typeof o.signedAt === "string" ? o.signedAt : null,
        sentAt: typeof o.sentAt === "string" ? o.sentAt : null,
        sentBy: typeof o.sentBy === "string" ? o.sentBy : null,
        createdAt:
          typeof o.createdAt === "string"
            ? o.createdAt
            : new Date().toISOString(),
        updatedAt:
          typeof o.updatedAt === "string"
            ? o.updatedAt
            : new Date().toISOString(),
      };
    });
}

export function useAgreements(
  stationId?: string,
  userId?: string,
): {
  agreements: Agreement[];
  loading: boolean;
  addAgreement: (
    a: Omit<
      Agreement,
      | "id"
      | "createdAt"
      | "updatedAt"
      | "status"
      | "signerName"
      | "signedAt"
      | "sentAt"
      | "sentBy"
    >,
  ) => Promise<Agreement>;
  updateAgreement: (id: string, patch: Partial<Agreement>) => Promise<void>;
  deleteAgreement: (id: string) => Promise<void>;
  sendForSignature: (id: string) => Promise<void>;
  signAgreement: (id: string, signerName: string) => Promise<void>;
} {
  const [agreements, setAgreements] = useState<Agreement[]>([]);
  const [loading, setLoading] = useState(true);
  const cloudLoadCompleteRef = useRef(false);
  const localModifiedRef = useRef(false);
  const agreementsRef = useRef<Agreement[]>([]);
  agreementsRef.current = agreements;

  const persist = useCallback(
    async (next: Agreement[]) => {
      setAgreements(next);
      localModifiedRef.current = true;
      try {
        await cloudStorageService.set(AGREEMENTS_KEY, next, stationId);
      } finally {
        localModifiedRef.current = false;
      }
    },
    [stationId],
  );

  useEffect(() => {
    let cancelled = false;
    cloudLoadCompleteRef.current = false;
    (async () => {
      const cached = cloudStorageService.getCached<unknown>(
        AGREEMENTS_KEY,
        stationId,
      );
      if (cached && !cancelled) setAgreements(normalizeAgreements(cached));
      try {
        const cloud = await cloudStorageService.get<unknown>(
          AGREEMENTS_KEY,
          stationId,
        );
        if (cancelled) return;
        if (cloud && !localModifiedRef.current)
          setAgreements(normalizeAgreements(cloud));
      } finally {
        if (!cancelled) cloudLoadCompleteRef.current = true;
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [stationId]);

  return {
    agreements,
    loading,
    addAgreement: useCallback(
      async (a) => {
        const now = new Date().toISOString();
        const rec: Agreement = {
          id: `agr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          title: a.title,
          clientName: a.clientName,
          clientEmail: a.clientEmail,
          terms: a.terms,
          startDate: a.startDate,
          endDate: a.endDate,
          status: "draft",
          signerName: null,
          signedAt: null,
          sentAt: null,
          sentBy: null,
          createdAt: now,
          updatedAt: now,
        };
        const next = [rec, ...agreementsRef.current];
        await persist(next);
        return rec;
      },
      [persist],
    ),
    updateAgreement: useCallback(
      async (id, patch) => {
        await persist(
          agreementsRef.current.map((a) =>
            a.id === id
              ? { ...a, ...patch, updatedAt: new Date().toISOString() }
              : a,
          ),
        );
      },
      [persist],
    ),
    deleteAgreement: useCallback(
      async (id) => {
        await persist(agreementsRef.current.filter((a) => a.id !== id));
      },
      [persist],
    ),
    sendForSignature: useCallback(
      async (id) => {
        const now = new Date().toISOString();
        await persist(
          agreementsRef.current.map((a) =>
            a.id === id
              ? {
                  ...a,
                  status: "sent" as AgreementStatus,
                  sentAt: now,
                  sentBy: userId ?? "owner",
                  updatedAt: now,
                }
              : a,
          ),
        );
      },
      [persist, userId],
    ),
    signAgreement: useCallback(
      async (id, signerName) => {
        const now = new Date().toISOString();
        await persist(
          agreementsRef.current.map((a) =>
            a.id === id
              ? {
                  ...a,
                  status: "signed" as AgreementStatus,
                  signerName: signerName.trim() || a.signerName,
                  signedAt: now,
                  updatedAt: now,
                }
              : a,
          ),
        );
      },
      [persist],
    ),
  };
}
