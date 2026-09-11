/**
 * Subtitle / closed-caption language registry for Live TV.
 *
 * Provides the default language list, browser/location-based auto-detection,
 * and matching logic that maps a preferred language onto the subtitle tracks
 * an HLS stream actually carries (matched by ISO lang code or track name).
 */

export interface SubtitleLanguage {
  /** ISO 639-1/639-2 primary code(s) used to match HLS track `lang` fields. */
  codes: string[];
  /** Display label in the picker. */
  label: string;
  /** Native name (shown secondarily). */
  native: string;
}

/** Default languages offered in the picker (per the requested defaults). */
export const SUBTITLE_LANGUAGES: SubtitleLanguage[] = [
  { codes: ["en", "eng"], label: "English", native: "English" },
  { codes: ["es", "spa"], label: "Spanish", native: "Español" },
  { codes: ["fr", "fra", "fre"], label: "French", native: "Français" },
  { codes: ["zh", "zho", "chi", "cmn"], label: "Mandarin", native: "中文" },
  { codes: ["hi", "hin"], label: "Hindi", native: "हिन्दी" },
  { codes: ["ar", "ara"], label: "Arabic", native: "العربية" },
  { codes: ["ko", "kor"], label: "Korean", native: "한국어" },
  { codes: ["pt", "por"], label: "Portuguese", native: "Português" },
  { codes: ["de", "deu", "ger"], label: "German", native: "Deutsch" },
  { codes: ["it", "ita"], label: "Italian", native: "Italiano" },
  { codes: ["ja", "jpn"], label: "Japanese", native: "日本語" },
  { codes: ["ru", "rus"], label: "Russian", native: "Русский" },
  { codes: ["sw", "swa"], label: "Swahili", native: "Kiswahili" },
  { codes: ["tr", "tur"], label: "Turkish", native: "Türkçe" },
  { codes: ["nl", "nld", "dut"], label: "Dutch", native: "Nederlands" },
];

/**
 * Country → primary subtitle language. Used as a fallback when the browser
 * locale is unavailable/generic (auto-select "depending on location").
 */
const COUNTRY_TO_LANG: Record<string, string> = {
  US: "en",
  GB: "en",
  CA: "en",
  AU: "en",
  NZ: "en",
  IE: "en",
  KE: "en",
  NG: "en",
  GH: "en",
  ZA: "en",
  UG: "en",
  TZ: "sw",
  ES: "es",
  MX: "es",
  AR: "es",
  CO: "es",
  CL: "es",
  PE: "es",
  VE: "es",
  FR: "fr",
  BE: "fr",
  CH: "fr",
  CN: "zh",
  TW: "zh",
  HK: "zh",
  SG: "zh",
  IN: "hi",
  SA: "ar",
  AE: "ar",
  EG: "ar",
  MA: "ar",
  DZ: "ar",
  QA: "ar",
  KR: "ko",
  PT: "pt",
  BR: "pt",
  DE: "de",
  AT: "de",
  IT: "it",
  JP: "ja",
  RU: "ru",
  TR: "tr",
  NL: "nl",
};

/**
 * Resolve the auto-selected subtitle language for the user's location.
 * Priority: browser locale primary subtag → station country mapping → "en".
 */
export function detectPreferredSubtitleLang(stationCountry?: string): string {
  try {
    const nav = (navigator.language || "").toLowerCase();
    const primary = nav.split("-")[0];
    if (primary && SUBTITLE_LANGUAGES.some((l) => l.codes.includes(primary))) {
      return primary;
    }
  } catch {
    /* navigator unavailable (SSR) */
  }
  if (stationCountry) {
    const mapped = COUNTRY_TO_LANG[stationCountry.toUpperCase()];
    if (mapped) return mapped;
  }
  return "en";
}

/**
 * Find the subtitle-track index in an HLS stream matching a preferred
 * language code. Matches on the track `lang` field first, then the track
 * name (many streams only label tracks by name). Returns -1 if no match.
 */
export function findSubtitleTrackIndex(
  tracks: { lang?: string; name?: string }[],
  preferredLang: string,
): number {
  const pref = preferredLang.toLowerCase();
  // Exact lang code match (e.g. "en", "eng")
  const byLang = tracks.findIndex((t) => (t.lang || "").toLowerCase() === pref);
  if (byLang >= 0) return byLang;
  // Lang code prefix match (e.g. "en-US" matches "en")
  const byPrefix = tracks.findIndex((t) =>
    (t.lang || "").toLowerCase().startsWith(pref),
  );
  if (byPrefix >= 0) return byPrefix;
  // Name match (e.g. track named "English" or "English CC")
  const langDef = SUBTITLE_LANGUAGES.find((l) => l.codes.includes(pref));
  if (langDef) {
    const needle = langDef.label.toLowerCase();
    const byName = tracks.findIndex((t) =>
      (t.name || "").toLowerCase().includes(needle),
    );
    if (byName >= 0) return byName;
  }
  return -1;
}
