/**
 * payroll-localization.ts — country-aware labels for the Payroll System.
 *
 * Statutory deduction names differ by country (Kenya: KRA PIN / SHA / NSSF;
 * Uganda: TIN / SHU / NSSF; US: SSN / Health Insurance / 401(k); etc.).
 * This registry maps a country code to the local terminology so the
 * employee form, payslip, exports, and settings modals all speak the
 * station's language instead of always showing Kenya's.
 */
import { getDetectedCountryCode } from "./currency";

export interface PayrollLabels {
  /** National tax identifier (KRA PIN / TIN / TRN / ITN / SSN / Tax PIN). */
  taxPin: string;
  /** National medical cover (SHA / SHU / Health Insurance / Medical Cover). */
  medicalCover: string;
  /** National social security fund (NSSF / 401(k) / EPF / SSNIT / ...). */
  socialFund: string;
}

const FALLBACK: PayrollLabels = {
  taxPin: "Tax PIN",
  medicalCover: "Medical Cover",
  socialFund: "Social Security",
};

const REGISTRY: Record<string, PayrollLabels> = {
  // Kenya — the app's primary market.
  KE: { taxPin: "KRA PIN", medicalCover: "SHA", socialFund: "NSSF" },
  // Uganda — NSSF Uganda + SHU + URA TIN.
  UG: { taxPin: "TIN", medicalCover: "SHU", socialFund: "NSSF" },
  // Tanzania — NSSF (WCF) + NHIF + TRA TIN.
  TZ: { taxPin: "TIN", medicalCover: "NHIF", socialFund: "NSSF" },
  // Rwanda — RSSB covers both medical (CBHI) + pension.
  RW: { taxPin: "TIN", medicalCover: "RAMA/CBHI", socialFund: "RSSB" },
  // Nigeria — NSITF/NHF + PENCOM pension + FIRS TIN.
  NG: { taxPin: "TIN", medicalCover: "NHIS", socialFund: "PENCOM" },
  // Ghana — SSNIT + NHIS + GRA TIN.
  GH: { taxPin: "TIN", medicalCover: "NHIS", socialFund: "SSNIT" },
  // South Africa — UIF + medical aid + SARS Tax Number.
  ZA: {
    taxPin: "Tax Number",
    medicalCover: "Medical Aid",
    socialFund: "UIF",
  },
  // United States — SSN + employer health insurance + 401(k).
  US: {
    taxPin: "SSN",
    medicalCover: "Health Insurance",
    socialFund: "401(k)",
  },
  // United Kingdom — NINO + NHS + workplace pension.
  GB: {
    taxPin: "NINO",
    medicalCover: "NHS",
    socialFund: "Pension",
  },
  // Canada — SIN + provincial health + RRSP.
  CA: { taxPin: "SIN", medicalCover: "Health Plan", socialFund: "RRSP" },
  // India — PAN + ESI + EPF.
  IN: { taxPin: "PAN", medicalCover: "ESI", socialFund: "EPF" },
  // Ethiopia — TIN + CBHI + social security.
  ET: { taxPin: "TIN", medicalCover: "CBHI", socialFund: "Social Security" },
  // Zambia — TPIN + NHIMA + NAPSA.
  ZM: { taxPin: "TPIN", medicalCover: "NHIMA", socialFund: "NAPSA" },
  // Malawi — TIN + medical cover + pension.
  MW: {
    taxPin: "TIN",
    medicalCover: "Medical Cover",
    socialFund: "Pension Fund",
  },
  // Botswana — TIN + medical aid + pension.
  BW: {
    taxPin: "TIN",
    medicalCover: "Medical Aid",
    socialFund: "Pension Fund",
  },
  // UAE — TRN + mandatory health insurance + end-of-service (no social fund).
  AE: {
    taxPin: "TRN",
    medicalCover: "Health Insurance",
    socialFund: "End-of-Service",
  },
  // Saudi Arabia — VAT/TIN + GOSI social insurance.
  SA: { taxPin: "TIN", medicalCover: "Health Insurance", socialFund: "GOSI" },
  // Egypt — Tax ID + comprehensive health insurance + social insurance.
  EG: {
    taxPin: "Tax ID",
    medicalCover: "Health Insurance",
    socialFund: "Social Insurance",
  },
  // Philippines — TIN + PhilHealth + SSS.
  PH: { taxPin: "TIN", medicalCover: "PhilHealth", socialFund: "SSS" },
  // Indonesia — NPWP + BPJS Kesehatan (health) + BPJS Ketenagakerjaan.
  ID: { taxPin: "NPWP", medicalCover: "BPJS Kesehatan", socialFund: "BPJS" },
  // Pakistan — NTN + EOBI pension + health.
  PK: { taxPin: "NTN", medicalCover: "Health Insurance", socialFund: "EOBI" },
  // Bangladesh — TIN + health + provident fund.
  BD: {
    taxPin: "TIN",
    medicalCover: "Health Insurance",
    socialFund: "Provident Fund",
  },
  // Australia — TFN + Medicare + Superannuation.
  AU: { taxPin: "TFN", medicalCover: "Medicare", socialFund: "Super" },
  // New Zealand — IRD number + KiwiSaver.
  NZ: {
    taxPin: "IRD Number",
    medicalCover: "Health Insurance",
    socialFund: "KiwiSaver",
  },
  // Germany — Steuer-ID + Krankenversicherung + Rentenversicherung.
  DE: {
    taxPin: "Steuer-ID",
    medicalCover: "Health Insurance",
    socialFund: "Pension Insurance",
  },
  // France — Numéro fiscal + Assurance maladie + Retraite.
  FR: {
    taxPin: "Numéro Fiscal",
    medicalCover: "Health Insurance",
    socialFund: "Pension",
  },
};

/** Resolves the payroll terminology for a country (default = detected). */
export function getPayrollLabels(countryCode?: string): PayrollLabels {
  const cc = (countryCode || getDetectedCountryCode()).toUpperCase();
  return REGISTRY[cc] ?? FALLBACK;
}
