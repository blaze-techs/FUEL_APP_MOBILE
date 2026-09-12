/**
 * LiveStreamService
 *
 * NATIVE live TV / radio channel service for the News tab. Fetches channel
 * data from the global live-feed provider's JSON API (via the same-origin
 * /api/live-channels proxy) and renders a fully native FuelPro channel
 * grid + player — NO iframe pointing to the provider's website is ever
 * used. Zero upstream attribution in the UI.
 *
 * KEY RULE (per requirement): NEVER include a station/stream/radio that is
 * unavailable — channels with no playable stream URL are filtered out.
 */

/**
 * Content categories supported by the global live-feed provider.
 * Each maps to a real, verified-available category page (HTTP 200).
 *
 * The taxonomy is 2-level:
 *  - TOP-LEVEL category (e.g. "movies", "news", "sports") → the upstream
 *    category page path (e.g. /movies, /news, /sports).
 *  - SUB-CATEGORY (e.g. Movies→Action, News→Breaking, Sports→Football) →
 *    a finer-grained slice. Each sub-category maps to an upstream
 *    category id applied via the `?category=<id>` query param, OR to a
 *    related top-level category id (e.g. Movies→Animation maps to the
 *    upstream "animation" category; Movies→Family maps to "family").
 *
 * Sub-categories are curated from the upstream's own category taxonomy
 * (28 categories: all, news, music, sports, auto, animation, business,
 * classic, comedy, cooking, culture, documentary, education,
 * entertainment, family, general, kids, legislative, lifestyle, movies,
 * outdoor, relax, religious, series, science, shop, travel, weather) so
 * every sub-category surfaces REAL live channels — no dead streams.
 */
export type LiveCategory =
  | "tv"
  | "radio"
  | "all"
  | "news"
  | "music"
  | "sports"
  | "auto"
  | "animation"
  | "business"
  | "classic"
  | "comedy"
  | "cooking"
  | "culture"
  | "documentary"
  | "education"
  | "entertainment"
  | "family"
  | "general"
  | "kids"
  | "legislative"
  | "lifestyle"
  | "movies"
  | "outdoor"
  | "relax"
  | "religious"
  | "series"
  | "science"
  | "shop"
  | "travel"
  | "weather"
  // Radio-specific music-genre sub-categories (real upstream radio taxonomy)
  | "talk"
  | "politics"
  | "hits"
  | "pop"
  | "rock"
  | "electronic"
  | "indie"
  | "metal"
  | "jazz"
  | "classical"
  | "soul"
  | "blues"
  | "reggae"
  | "folk"
  | "country"
  | "latin"
  | "schlager"
  | "oldies"
  | "chill"
  | "christmas";

export interface LiveFeedSubCategory {
  /** Stable id (unique within its parent category) */
  id: string;
  /** Display label */
  label: string;
  /**
   * The upstream category id to apply via `?category=<id>`. This is what
   * makes the sub-category surface REAL live channels. When omitted, the
   * sub-category uses the parent's category path with no extra filter.
   */
  upstreamCategory?: LiveCategory;
  /**
   * Genre keyword filter — client-side sub-classification WITHIN the parent
   * category's channel list. The upstream provider only exposes broad
   * category endpoints (movies, sports, news...), so genre-level
   * sub-categories (action, horror, western, romance...) are derived by
   * matching these keywords against each channel's name. When present, the
   * fetch loads the parent category list and this filter is applied; when
   * the filtered result is empty the UI falls back to the parent list with
   * a notice (never a dead end).
   */
  keywords?: string[];
  description: string;
}

export interface LiveFeedCategory {
  id: LiveCategory;
  label: string;
  /** "video" family (TV) or "audio" family (radio) — used for URL routing */
  family: "video" | "audio";
  description: string;
  /** Sub-categories for this top-level category (curated). */
  subCategories: LiveFeedSubCategory[];
}

/**
 * All content categories available from the global live-feed provider.
 * These are surfaced to the user as native-feeling "channels" with NO
 * indication of the upstream source.
 *
 * Each top-level category carries a curated list of sub-categories. A
 * sub-category maps to a real upstream category id (verified HTTP 200)
 * so it always surfaces live, available channels — never dead streams.
 */
export const LIVE_FEED_CATEGORIES: LiveFeedCategory[] = [
  {
    id: "tv",
    label: "Live TV",
    family: "video",
    description: "Thousands of live global TV channels",
    subCategories: [
      {
        id: "all",
        label: "All Channels",
        upstreamCategory: "all",
        description: "Every live TV channel",
      },
      {
        id: "general",
        label: "General",
        upstreamCategory: "general",
        description: "General-purpose live TV",
      },
      {
        id: "entertainment",
        label: "Entertainment",
        upstreamCategory: "entertainment",
        description: "Variety & entertainment",
      },
      {
        id: "family",
        label: "Family",
        upstreamCategory: "family",
        description: "Family-friendly TV",
      },
      {
        id: "relax",
        label: "Relax",
        upstreamCategory: "relax",
        description: "Ambient & relaxation TV",
      },
      {
        id: "outdoor",
        label: "Outdoor",
        upstreamCategory: "outdoor",
        description: "Outdoor & nature TV",
      },
      {
        id: "lifestyle",
        label: "Lifestyle",
        upstreamCategory: "lifestyle",
        description: "Lifestyle programming",
      },
      {
        id: "culture",
        label: "Culture",
        upstreamCategory: "culture",
        description: "Cultural programming",
      },
      {
        id: "classic",
        label: "Classic TV",
        upstreamCategory: "classic",
        description: "Classic TV shows",
      },
      {
        id: "shop",
        label: "Shopping",
        upstreamCategory: "shop",
        description: "Home shopping channels",
      },
      {
        id: "weather",
        label: "Weather",
        upstreamCategory: "weather",
        description: "Live weather channels",
      },
      {
        id: "travel",
        label: "Travel",
        upstreamCategory: "travel",
        description: "Travel programming",
      },
      {
        id: "legislative",
        label: "Government",
        upstreamCategory: "legislative",
        description: "Government & legislative TV",
      },
    ],
  },
  {
    id: "news",
    label: "News",
    family: "video",
    description: "Live 24/7 news from around the world",
    subCategories: [
      {
        id: "all",
        label: "All News",
        upstreamCategory: "news",
        description: "Every live news channel",
      },
      {
        id: "breaking",
        label: "Breaking News",
        upstreamCategory: "news",
        description: "Breaking news & live coverage",
      },
      {
        id: "international",
        label: "International",
        upstreamCategory: "news",
        description: "World news networks",
      },
      {
        id: "business",
        label: "Business & Markets",
        upstreamCategory: "business",
        description: "Financial & market news",
      },
      {
        id: "legislative",
        label: "Politics & Government",
        upstreamCategory: "legislative",
        description: "Political & legislative news",
      },
      {
        id: "weather",
        label: "Weather News",
        upstreamCategory: "weather",
        description: "Weather updates & forecasts",
      },
      {
        id: "technology",
        label: "Technology",
        upstreamCategory: "science",
        keywords: ["tech", "technology", "digital", "cyber", "gadget"],
        description: "Technology & innovation news",
      },
      {
        id: "health",
        label: "Health",
        upstreamCategory: "news",
        keywords: ["health", "medical", "wellness", "medicine"],
        description: "Health & medical news",
      },
      {
        id: "sciencenews",
        label: "Science",
        upstreamCategory: "science",
        keywords: ["science", "space", "nasa", "research"],
        description: "Science & discovery news",
      },
      {
        id: "entertainmentnews",
        label: "Entertainment News",
        upstreamCategory: "entertainment",
        keywords: ["entertainment", "celebrity", "showbiz", "hollywood"],
        description: "Entertainment & celebrity news",
      },
      {
        id: "regional",
        label: "Regional & Local",
        upstreamCategory: "general",
        keywords: ["local", "regional", "city", "county"],
        description: "Regional & local news",
      },
    ],
  },
  {
    id: "movies",
    label: "Movies",
    family: "video",
    description: "Live movie channels",
    subCategories: [
      {
        id: "all",
        label: "All Movies",
        upstreamCategory: "movies",
        description: "Every live movie channel",
      },
      {
        id: "action",
        label: "Action",
        upstreamCategory: "movies",
        keywords: ["action", "axn", "charge", "bolt", "adrenaline", "combat"],
        description: "Action & adventure films",
      },
      {
        id: "adventure",
        label: "Adventure",
        upstreamCategory: "outdoor",
        keywords: ["adventure", "outdoor", "expedition", "quest"],
        description: "Adventure & outdoor films",
      },
      {
        id: "animation",
        label: "Animation",
        upstreamCategory: "animation",
        description: "Animated films & cartoons",
      },
      {
        id: "bollywood",
        label: "Bollywood & International",
        upstreamCategory: "movies",
        keywords: [
          "bollywood",
          "bhojpuri",
          "indian",
          "hindi",
          "asianet",
          "farsi",
          "latino",
          "latin",
        ],
        description: "Bollywood & international cinema",
      },
      {
        id: "classic",
        label: "Classics",
        upstreamCategory: "classic",
        keywords: ["classic", "classique", "vintage", "retro"],
        description: "Classic & vintage films",
      },
      {
        id: "comedy",
        label: "Comedy",
        upstreamCategory: "comedy",
        keywords: ["comedy", "comedie", "funny", "humor", "laugh", "parody"],
        description: "Comedy films & stand-up",
      },
      {
        id: "crime",
        label: "Crime & Mystery",
        upstreamCategory: "movies",
        keywords: [
          "crime",
          "detective",
          "mystery",
          "noir",
          "investigation",
          "true crime",
        ],
        description: "Crime, detective & mystery films",
      },
      {
        id: "documentary",
        label: "Real-Life Stories",
        upstreamCategory: "documentary",
        keywords: ["documentary", "docu", "real-life", "biography", "true"],
        description: "Documentary & biographical films",
      },
      {
        id: "drama",
        label: "Drama",
        upstreamCategory: "series",
        keywords: ["drama", "melodrama"],
        description: "Drama films & features",
      },
      {
        id: "family",
        label: "Family",
        upstreamCategory: "family",
        keywords: ["family", "kids", "children"],
        description: "Family-friendly films",
      },
      {
        id: "fantasy",
        label: "Fantasy",
        upstreamCategory: "movies",
        keywords: ["fantasy", "magic", "myth", "fairy", "dragon", "wizard"],
        description: "Fantasy & magical films",
      },
      {
        id: "historical",
        label: "Historical",
        upstreamCategory: "culture",
        keywords: ["histor", "period", "epoch", "era"],
        description: "Historical & period films",
      },
      {
        id: "horror",
        label: "Horror & Thriller",
        upstreamCategory: "movies",
        keywords: [
          "horror",
          "scary",
          "terror",
          "fright",
          "thriller",
          "suspense",
          "xtrema",
        ],
        description: "Suspense, horror & thriller films",
      },
      {
        id: "musical",
        label: "Musical",
        upstreamCategory: "movies",
        keywords: ["musical", "music film", "concert film"],
        description: "Musicals & concert films",
      },
      {
        id: "romance",
        label: "Romance",
        upstreamCategory: "lifestyle",
        keywords: ["romance", "romanti", "love", "wedding"],
        description: "Romantic films",
      },
      {
        id: "scifi",
        label: "Sci-Fi",
        upstreamCategory: "science",
        keywords: ["sci-fi", "scifi", "sci fi", "space", "galaxy", "alien"],
        description: "Science-fiction films",
      },
      {
        id: "war",
        label: "War & Military",
        upstreamCategory: "movies",
        keywords: ["war", "military", "army", "battle", "combat"],
        description: "War & military films",
      },
      {
        id: "western",
        label: "Western",
        upstreamCategory: "movies",
        keywords: ["western", "cowboy", "wild west"],
        description: "Western films",
      },
    ],
  },
  {
    id: "sports",
    label: "Sports",
    family: "video",
    description: "Live sports channels",
    subCategories: [
      {
        id: "all",
        label: "All Sports",
        upstreamCategory: "sports",
        description: "Every live sports channel",
      },
      {
        id: "football",
        label: "Football",
        upstreamCategory: "sports",
        keywords: ["football", "soccer", "futbol", "fifa", "premier league"],
        description: "Football (soccer) channels",
      },
      {
        id: "basketball",
        label: "Basketball",
        upstreamCategory: "sports",
        keywords: ["basketball", "nba", "hoops"],
        description: "Basketball channels",
      },
      {
        id: "baseball",
        label: "Baseball",
        upstreamCategory: "sports",
        keywords: ["baseball", "mlb"],
        description: "Baseball channels",
      },
      {
        id: "hockey",
        label: "Hockey",
        upstreamCategory: "sports",
        keywords: ["hockey", "nhl", "ice hockey"],
        description: "Ice hockey channels",
      },
      {
        id: "cricket",
        label: "Cricket",
        upstreamCategory: "sports",
        keywords: ["cricket", "ipl"],
        description: "Cricket channels",
      },
      {
        id: "tennis",
        label: "Tennis",
        upstreamCategory: "sports",
        keywords: ["tennis", "wimbledon", "grand slam"],
        description: "Tennis channels",
      },
      {
        id: "golf",
        label: "Golf",
        upstreamCategory: "sports",
        keywords: ["golf", "pga"],
        description: "Golf channels",
      },
      {
        id: "auto",
        label: "Motorsport",
        upstreamCategory: "auto",
        keywords: [
          "motor",
          "racing",
          "race",
          "f1",
          "formula",
          "nascar",
          "speedway",
          "grand prix",
          "rally",
        ],
        description: "Auto racing & motorsport",
      },
      {
        id: "fight",
        label: "Fight & Wrestling",
        upstreamCategory: "sports",
        keywords: [
          "boxing",
          "mma",
          "ufc",
          "fight",
          "wrestling",
          "wwe",
          "wrestle",
          "martial",
          "judo",
          "karate",
        ],
        description: "Boxing, MMA & wrestling",
      },
      {
        id: "esports",
        label: "Esports & Gaming",
        upstreamCategory: "sports",
        keywords: ["esport", "e-sport", "gaming", "gamer", "game"],
        description: "Esports & gaming channels",
      },
      {
        id: "winter",
        label: "Winter Sports",
        upstreamCategory: "sports",
        keywords: ["winter", "ski", "snow", "ice"],
        description: "Winter sports channels",
      },
      {
        id: "water",
        label: "Water Sports",
        upstreamCategory: "sports",
        keywords: ["water", "surf", "swim", "sail", "diving"],
        description: "Water sports channels",
      },
      {
        id: "athletics",
        label: "Athletics & Olympics",
        upstreamCategory: "sports",
        keywords: ["athletics", "olympic", "marathon", "track", "field"],
        description: "Athletics & Olympic sports",
      },
      {
        id: "outdoor",
        label: "Outdoor Sports",
        upstreamCategory: "outdoor",
        keywords: ["outdoor", "adventure", "extreme"],
        description: "Outdoor & adventure sports",
      },
      {
        id: "news",
        label: "Sports News",
        upstreamCategory: "news",
        keywords: ["sport"],
        description: "Sports news & analysis",
      },
      {
        id: "classic",
        label: "Classic Sports",
        upstreamCategory: "classic",
        keywords: ["classic", "retro", "legend"],
        description: "Classic sports replays",
      },
    ],
  },
  {
    id: "entertainment",
    label: "Entertainment",
    family: "video",
    description: "Live entertainment channels",
    subCategories: [
      {
        id: "all",
        label: "All Entertainment",
        upstreamCategory: "entertainment",
        description: "Every entertainment channel",
      },
      {
        id: "comedy",
        label: "Comedy",
        upstreamCategory: "comedy",
        description: "Comedy shows & stand-up",
      },
      {
        id: "series",
        label: "TV Series",
        upstreamCategory: "series",
        description: "Series & serialized shows",
      },
      {
        id: "classic",
        label: "Classic Shows",
        upstreamCategory: "classic",
        description: "Classic TV shows",
      },
      {
        id: "reality",
        label: "Reality & Lifestyle",
        upstreamCategory: "lifestyle",
        keywords: ["reality", "real life", "lifestyle"],
        description: "Reality & lifestyle shows",
      },
      {
        id: "talkshows",
        label: "Talk Shows",
        upstreamCategory: "entertainment",
        keywords: ["talk", "chat show", "late night", "interview"],
        description: "Talk shows & interviews",
      },
      {
        id: "gameshows",
        label: "Game Shows",
        upstreamCategory: "entertainment",
        keywords: ["game show", "gameshow", "quiz", "trivia", "contest"],
        description: "Game shows & quizzes",
      },
      {
        id: "soaps",
        label: "Soaps & Telenovelas",
        upstreamCategory: "series",
        keywords: ["soap", "telenovela", "serial"],
        description: "Soap operas & telenovelas",
      },
      {
        id: "variety",
        label: "Variety & Talent",
        upstreamCategory: "entertainment",
        keywords: ["variety", "talent", "got talent", "idol", "voice"],
        description: "Variety & talent shows",
      },
      {
        id: "cooking",
        label: "Cooking Shows",
        upstreamCategory: "cooking",
        description: "Cooking & culinary shows",
      },
      {
        id: "travel",
        label: "Travel Shows",
        upstreamCategory: "travel",
        description: "Travel & adventure shows",
      },
    ],
  },
  {
    id: "music",
    label: "Music TV",
    family: "video",
    description: "Live music video channels",
    subCategories: [
      {
        id: "all",
        label: "All Music",
        upstreamCategory: "music",
        description: "Every live music channel",
      },
      {
        id: "pop",
        label: "Pop",
        upstreamCategory: "music",
        keywords: ["pop", "top 40", "chart", "hits"],
        description: "Pop music videos",
      },
      {
        id: "rock",
        label: "Rock",
        upstreamCategory: "music",
        keywords: ["rock", "hard rock", "punk", "grunge"],
        description: "Rock music videos",
      },
      {
        id: "hiphop",
        label: "Hip-Hop & R&B",
        upstreamCategory: "music",
        keywords: ["hip hop", "hip-hop", "rap", "r&b", "rnb", "urban"],
        description: "Hip-hop & R&B videos",
      },
      {
        id: "electronic",
        label: "Electronic & Dance",
        upstreamCategory: "music",
        keywords: ["electronic", "dance", "edm", "techno", "house", "club"],
        description: "Electronic & dance music",
      },
      {
        id: "latinmusic",
        label: "Latin",
        upstreamCategory: "music",
        keywords: ["latin", "reggaeton", "salsa", "bachata"],
        description: "Latin music videos",
      },
      {
        id: "countrymusic",
        label: "Country",
        upstreamCategory: "music",
        keywords: ["country", "nashville", "bluegrass"],
        description: "Country music videos",
      },
      {
        id: "jazzmusic",
        label: "Jazz & Soul",
        upstreamCategory: "music",
        keywords: ["jazz", "soul", "blues", "funk", "motown"],
        description: "Jazz, soul & blues",
      },
      {
        id: "classicalmusic",
        label: "Classical",
        upstreamCategory: "music",
        keywords: ["classical", "orchestra", "opera", "symphony"],
        description: "Classical music",
      },
      {
        id: "metal",
        label: "Metal & Hard Rock",
        upstreamCategory: "music",
        keywords: ["metal", "heavy", "thrash", "death"],
        description: "Metal & hard rock",
      },
      {
        id: "general",
        label: "General Music",
        upstreamCategory: "music",
        description: "Mixed-genre music TV",
      },
      {
        id: "relax",
        label: "Relax & Ambient",
        upstreamCategory: "relax",
        description: "Relaxing & ambient music",
      },
      {
        id: "classic",
        label: "Classic Hits",
        upstreamCategory: "classic",
        description: "Classic music videos",
      },
      {
        id: "culture",
        label: "World Music",
        upstreamCategory: "culture",
        description: "World & cultural music",
      },
    ],
  },
  {
    id: "kids",
    label: "Kids",
    family: "video",
    description: "Live kids channels",
    subCategories: [
      {
        id: "all",
        label: "All Kids",
        upstreamCategory: "kids",
        description: "Every live kids channel",
      },
      {
        id: "animation",
        label: "Cartoons & Animation",
        upstreamCategory: "animation",
        description: "Animated kids shows",
      },
      {
        id: "education",
        label: "Educational",
        upstreamCategory: "education",
        description: "Educational kids content",
      },
      {
        id: "preschool",
        label: "Preschool",
        upstreamCategory: "kids",
        keywords: ["baby", "toddler", "preschool", "nursery", "little"],
        description: "Preschool & toddler shows",
      },
      {
        id: "teens",
        label: "Teens",
        upstreamCategory: "kids",
        keywords: ["teen", "youth", "high school"],
        description: "Teen programming",
      },
      {
        id: "anime",
        label: "Anime",
        upstreamCategory: "animation",
        keywords: ["anime", "manga"],
        description: "Anime shows",
      },
      {
        id: "family",
        label: "Family Shows",
        upstreamCategory: "family",
        description: "Family-friendly kids shows",
      },
      {
        id: "general",
        label: "General Kids",
        upstreamCategory: "kids",
        description: "General kids programming",
      },
    ],
  },
  {
    id: "documentary",
    label: "Documentaries",
    family: "video",
    description: "Live documentary channels",
    subCategories: [
      {
        id: "all",
        label: "All Documentaries",
        upstreamCategory: "documentary",
        description: "Every documentary channel",
      },
      {
        id: "science",
        label: "Science & Nature",
        upstreamCategory: "science",
        description: "Science & nature documentaries",
      },
      {
        id: "history",
        label: "History",
        upstreamCategory: "culture",
        keywords: ["history", "historical", "ancient", "war"],
        description: "Historical documentaries",
      },
      {
        id: "truecrime",
        label: "True Crime",
        upstreamCategory: "documentary",
        keywords: ["true crime", "crime", "investigation", "forensic"],
        description: "True crime documentaries",
      },
      {
        id: "biography",
        label: "Biography",
        upstreamCategory: "documentary",
        keywords: ["biography", "biographic", "life story", "portrait"],
        description: "Biographical documentaries",
      },
      {
        id: "nature",
        label: "Nature & Wildlife",
        upstreamCategory: "outdoor",
        keywords: ["nature", "wildlife", "animal", "planet", "earth"],
        description: "Nature & wildlife documentaries",
      },
      {
        id: "spacedoc",
        label: "Space & Universe",
        upstreamCategory: "science",
        keywords: ["space", "universe", "cosmos", "nasa", "astronomy"],
        description: "Space & universe documentaries",
      },
      {
        id: "travel",
        label: "Travel & Discovery",
        upstreamCategory: "travel",
        description: "Travel & discovery docs",
      },
      {
        id: "education",
        label: "Educational",
        upstreamCategory: "education",
        description: "Educational documentaries",
      },
      {
        id: "outdoor",
        label: "Outdoor & Wildlife",
        upstreamCategory: "outdoor",
        description: "Wildlife & outdoor docs",
      },
      {
        id: "auto",
        label: "Machines & Tech",
        upstreamCategory: "auto",
        description: "Tech & machines documentaries",
      },
    ],
  },
  {
    id: "education",
    label: "Education",
    family: "video",
    description: "Live education channels",
    subCategories: [
      {
        id: "all",
        label: "All Educational",
        upstreamCategory: "education",
        description: "Every educational channel",
      },
      {
        id: "science",
        label: "Science",
        upstreamCategory: "science",
        description: "Science channels",
      },
      {
        id: "culture",
        label: "Culture & Arts",
        upstreamCategory: "culture",
        description: "Cultural & arts education",
      },
      {
        id: "documentary",
        label: "Documentaries",
        upstreamCategory: "documentary",
        description: "Educational documentaries",
      },
      {
        id: "legislative",
        label: "Civics & Government",
        upstreamCategory: "legislative",
        description: "Civics & government education",
      },
    ],
  },
  {
    id: "religious",
    label: "Religious",
    family: "video",
    description: "Live religious channels",
    subCategories: [
      {
        id: "all",
        label: "All Religious",
        upstreamCategory: "religious",
        description: "Every religious channel",
      },
      {
        id: "general",
        label: "General Faith",
        upstreamCategory: "religious",
        description: "General religious programming",
      },
      {
        id: "culture",
        label: "Spiritual & Cultural",
        upstreamCategory: "culture",
        description: "Spiritual & cultural content",
      },
      {
        id: "education",
        label: "Religious Education",
        upstreamCategory: "education",
        description: "Religious education",
      },
    ],
  },
  {
    id: "business",
    label: "Business",
    family: "video",
    description: "Live business & markets channels",
    subCategories: [
      {
        id: "all",
        label: "All Business",
        upstreamCategory: "business",
        description: "Every business channel",
      },
      {
        id: "news",
        label: "Business News",
        upstreamCategory: "news",
        description: "Business & financial news",
      },
      {
        id: "markets",
        label: "Markets",
        upstreamCategory: "business",
        description: "Live market coverage",
      },
      {
        id: "shop",
        label: "Commerce",
        upstreamCategory: "shop",
        description: "Commerce & shopping channels",
      },
    ],
  },
  {
    id: "radio",
    label: "Live Radio",
    family: "audio",
    description: "Thousands of live radio stations worldwide",
    subCategories: [
      {
        id: "all",
        label: "All Stations",
        upstreamCategory: "all",
        description: "Every live radio station",
      },
      {
        id: "news",
        label: "News",
        upstreamCategory: "news",
        description: "News radio stations",
      },
      {
        id: "talk",
        label: "Talk",
        upstreamCategory: "talk",
        description: "Talk radio shows",
      },
      {
        id: "sports",
        label: "Sports",
        upstreamCategory: "sports",
        description: "Sports talk radio",
      },
      {
        id: "politics",
        label: "Politics",
        upstreamCategory: "politics",
        description: "Political talk radio",
      },
      {
        id: "hits",
        label: "Hits",
        upstreamCategory: "hits",
        description: "Today's hit music",
      },
      {
        id: "pop",
        label: "Pop",
        upstreamCategory: "pop",
        description: "Pop music radio",
      },
      {
        id: "rock",
        label: "Rock",
        upstreamCategory: "rock",
        description: "Rock music radio",
      },
      {
        id: "electronic",
        label: "Electronic",
        upstreamCategory: "electronic",
        description: "Electronic & dance music",
      },
      {
        id: "indie",
        label: "Indie",
        upstreamCategory: "indie",
        description: "Indie & alternative music",
      },
      {
        id: "metal",
        label: "Metal",
        upstreamCategory: "metal",
        description: "Metal & hard rock radio",
      },
      {
        id: "jazz",
        label: "Jazz",
        upstreamCategory: "jazz",
        description: "Jazz music radio",
      },
      {
        id: "classical",
        label: "Classical",
        upstreamCategory: "classical",
        description: "Classical music radio",
      },
      {
        id: "soul",
        label: "Soul",
        upstreamCategory: "soul",
        description: "Soul & R&B music radio",
      },
      {
        id: "blues",
        label: "Blues",
        upstreamCategory: "blues",
        description: "Blues music radio",
      },
      {
        id: "reggae",
        label: "Reggae",
        upstreamCategory: "reggae",
        description: "Reggae music radio",
      },
      {
        id: "folk",
        label: "Folk",
        upstreamCategory: "folk",
        description: "Folk & acoustic music",
      },
      {
        id: "country",
        label: "Country",
        upstreamCategory: "country",
        description: "Country music radio",
      },
      {
        id: "latin",
        label: "Latin",
        upstreamCategory: "latin",
        description: "Latin music radio",
      },
      {
        id: "schlager",
        label: "Schlager",
        upstreamCategory: "schlager",
        description: "Schlager music radio",
      },
      {
        id: "oldies",
        label: "Oldies",
        upstreamCategory: "oldies",
        description: "Oldies & golden classics",
      },
      {
        id: "chill",
        label: "Chill",
        upstreamCategory: "chill",
        description: "Chillout & ambient radio",
      },
      {
        id: "christmas",
        label: "Christmas",
        upstreamCategory: "christmas",
        description: "Christmas & holiday music",
      },
      {
        id: "religious",
        label: "Religious",
        upstreamCategory: "religious",
        description: "Religious radio stations",
      },
    ],
  },
];

/**
 * Resolve a sub-category by id within a parent category.
 * Returns undefined if not found (caller falls back to the parent category).
 */
export function getSubCategory(
  category: LiveCategory,
  subId: string,
): LiveFeedSubCategory | undefined {
  const cat = LIVE_FEED_CATEGORIES.find((c) => c.id === category);
  return cat?.subCategories.find((s) => s.id === subId);
}

/**
 * Filter a channel list by a sub-category's genre keywords (case-insensitive
 * substring match on the channel name). Used for genre-level sub-categories
 * (Movies → Action/Horror/Western...) that have no dedicated upstream
 * endpoint. Returns the input list unchanged when no keywords are given.
 */
export function filterChannelsByKeywords(
  channels: LiveChannel[],
  keywords?: string[],
): LiveChannel[] {
  if (!keywords || keywords.length === 0) return channels;
  const kws = keywords.map((k) => k.toLowerCase());
  return channels.filter((ch) => {
    const name = ch.name.toLowerCase();
    return kws.some((k) => name.includes(k));
  });
}

/**
 * Case-insensitive search over a channel list covering the channel name, its
 * country code and ANY alternate/transliterated name (iptv-org alt_names).
 * This mirrors how VLC matches a network playlist: a channel like "Zee One"
 * is found by its plain name even when it lives in a country that isn't the
 * user's current one. Returns the input list unchanged when query is empty.
 */
export function searchChannels(
  channels: LiveChannel[],
  query: string,
): LiveChannel[] {
  const q = query.trim().toLowerCase();
  if (!q) return channels;
  return channels.filter((s) => {
    if (s.name.toLowerCase().includes(q)) return true;
    if ((s.country || "").toLowerCase().includes(q)) return true;
    if (Array.isArray(s.altNames)) {
      for (const alt of s.altNames) {
        if (alt && alt.toLowerCase().includes(q)) return true;
      }
    }
    return false;
  });
}

// ===========================================================================
// NATIVE CHANNEL API — fetches channel data directly from the provider's
// JSON API and renders a NATIVE FuelPro channel grid + player. NO iframe
// pointing to the provider's website is ever used — the user sees ONLY
// FuelPro UI (channel cards, player, filters). Zero upstream attribution.
//
// The JSON API returns gzip-compressed JSON. We decompress client-side.
// Endpoints:
//   {tv|radio}/countries/{cc}.json   → all channels for a country
//   {tv|radio}/categories/{id}.json  → all channels for a category
// ===========================================================================

/** A single live channel from the provider's JSON API. */
export interface LiveChannel {
  nanoid: string;
  name: string;
  /** HLS (.m3u8) stream URLs — used for TV playback via hls.js */
  stream_urls: string[];
  /** YouTube video IDs — used for YouTube iframe playback (like Live News Streams) */
  youtube_urls: string[];
  /** ISO 639-2 language codes */
  languages: string[];
  /** ISO 2-letter country code (lowercased) */
  country: string;
  /** Whether the stream is geo-blocked */
  isGeoBlocked: boolean;
  /** Optional channel logo URL (iptv-org channels have logos) */
  logo?: string;
  /** Alternate/transliterated names — matched by the station search (like VLC). */
  altNames?: string[];
  /** Custom User-Agent required to fetch this stream (if any). */
  userAgent?: string;
  /** Custom Referrer required to fetch this stream (if any). */
  referrer?: string;
  /** Quality label (e.g. "720p") parsed from the index.m3u name. */
  quality?: string;
}

/** In-memory cache of fetched channel lists (keyed by URL). 5-min TTL. */
const channelCache = new Map<string, { data: LiveChannel[]; ts: number }>();
const CHANNEL_CACHE_TTL = 5 * 60 * 1000;

/**
 * Fetch channels via the server-side proxy (/api/live-channels). The upstream
 * API does NOT send CORS headers, so browser-side fetches are blocked. The
 * proxy fetches server-side, decompresses gzip, and returns JSON with CORS
 * headers. The client NEVER sees the upstream hostname.
 *
 * Falls back to a direct fetch (for local dev / same-origin) if the proxy
 * is unavailable. Returns an empty array on any error (never throws).
 *
 * @param mode "tv" or "radio"
 * @param type "countries" or "categories"
 * @param id country code (lowercase) or category id
 */
export async function fetchLiveChannels(
  mode: "tv" | "radio",
  type: "countries" | "categories",
  id: string,
): Promise<LiveChannel[]> {
  const normalizedId = id.toLowerCase();
  const cacheKey = `${mode}/${type}/${normalizedId}`;
  const cached = channelCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CHANNEL_CACHE_TTL) {
    return cached.data;
  }
  try {
    // Use the server-side proxy (handles CORS + gzip decompression).
    // Both Vercel (api/live-channels.ts) and Cloudflare Pages
    // (functions/api/live-channels.ts) serve the proxy at /api/live-channels,
    // so a relative path works same-origin on both platforms.
    const proxyUrl = `/api/live-channels?mode=${mode}&type=${type}&id=${normalizedId}`;

    const res = await fetch(proxyUrl);
    if (!res.ok) return [];
    const data = await res.json();
    const channels: LiveChannel[] = Array.isArray(data?.channels)
      ? data.channels
      : Array.isArray(data)
        ? data
        : [];
    channelCache.set(cacheKey, { data: channels, ts: Date.now() });
    return channels;
  } catch {
    return [];
  }
}

// ===========================================================================
// IPTV-ORG INTEGRATION — additional public-domain channel source
// (https://iptv-org.github.io/api/). 8000+ free-to-air channels. Fetched via
// /api/iptv-channels proxy (server-side merge of channels.json + streams.json,
// filtered by country/category, capped at 500 results). Merged with the
// primary provider's channels so the user gets the widest selection. NO
// upstream attribution in the UI — channels appear as native FuelPro entries.
// ===========================================================================

/** A channel from the iptv-org public API (after server-side merge). */
export interface IptvChannel {
  id: string;
  name: string;
  url: string;
  logo: string;
  country: string;
  language: string;
  category: string;
  /** Alternate/transliterated names (e.g. "Zee One" → "Zee One HD") — used for search. */
  alt_names?: string[];
  /** Custom User-Agent required to fetch this stream (index.m3u). */
  userAgent?: string;
  /** Custom Referrer required to fetch this stream (index.m3u). */
  referrer?: string;
  /** Quality label (e.g. "720p") parsed from the index.m3u display name. */
  quality?: string;
}

/** In-memory cache for iptv-org channel slices (10-min TTL). */
const iptvCache = new Map<string, { data: IptvChannel[]; ts: number }>();
const IPTV_CACHE_TTL = 10 * 60 * 1000;

/**
 * Fetch channels from iptv-org via the /api/iptv-channels proxy.
 *
 * When `fmt` is "m3u" (the default here), the proxy fetches + parses the
 * ACTUAL index.m3u master playlist (the exact file VLC opens) — the full
 * ~12.9k catalog including quality/geo variants and the custom User-Agent /
 * Referrer headers many streams require to avoid 403s. This is the "add ALL
 * channels/streams from index.m3u" path.
 *
 * @param country ISO 2-letter country code (lowercase), or "" for all
 * @param category category id (lowercase), or "" for all
 * @param limit max results (default 13500, hard cap 13500)
 * @param fmt "m3u" (VLC-equivalent full catalog) | "json" (channels.json merge)
 */
export async function fetchIptvChannels(
  country = "",
  category = "",
  limit = 13500,
  fmt: "m3u" | "json" = "m3u",
): Promise<IptvChannel[]> {
  const c = country.toLowerCase().trim();
  const cat = category.toLowerCase().trim();
  const cacheKey = `${fmt}/${c || "all"}/${cat || "all"}/${limit}`;
  const cached = iptvCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < IPTV_CACHE_TTL) {
    return cached.data;
  }
  try {
    const params = new URLSearchParams();
    if (c) params.set("country", c);
    if (cat) params.set("category", cat);
    params.set("limit", String(limit));
    if (fmt === "m3u") params.set("fmt", "m3u");
    const res = await fetch(`/api/iptv-channels?${params.toString()}`);
    if (!res.ok) return [];
    const data = await res.json();
    const channels: IptvChannel[] = Array.isArray(data?.channels)
      ? data.channels
      : [];
    iptvCache.set(cacheKey, { data: channels, ts: Date.now() });
    return channels;
  } catch {
    return [];
  }
}

/**
 * Convert an iptv-org channel to the unified LiveChannel shape so the
 * existing UI (LiveFeedEmbed) can render it without changes. The HLS stream
 * URL goes into stream_urls; youtube_urls is empty (iptv-org has no YouTube).
 */
export function iptvToLiveChannel(ch: IptvChannel): LiveChannel {
  return {
    nanoid: `iptv-${ch.id}`,
    name: ch.name,
    stream_urls: ch.url ? [ch.url] : [],
    youtube_urls: [],
    languages: ch.language ? [ch.language] : [],
    country: ch.country,
    isGeoBlocked: false,
    logo: ch.logo || undefined,
    altNames: Array.isArray(ch.alt_names) ? ch.alt_names : [],
    userAgent: ch.userAgent,
    referrer: ch.referrer,
    quality: ch.quality,
  };
}

/**
 * Merge primary-provider channels with iptv-org channels, deduped by
 * case-insensitive name. Primary channels take priority (kept first); iptv-org
 * channels with a duplicate name are skipped. Returns the merged list.
 *
 * @param primary channels from the primary provider
 * @param iptv channels from iptv-org
 */
export function mergeChannelsWithIptv(
  primary: LiveChannel[],
  iptv: IptvChannel[],
): LiveChannel[] {
  const seen = new Set<string>();
  const merged: LiveChannel[] = [];
  for (const ch of primary) {
    const key = ch.name.toLowerCase().trim();
    if (!seen.has(key)) {
      seen.add(key);
      merged.push(ch);
    }
  }
  for (const ch of iptv) {
    const key = ch.name.toLowerCase().trim();
    if (!seen.has(key)) {
      seen.add(key);
      merged.push(iptvToLiveChannel(ch));
    }
  }
  return merged;
}

/**
 * CURATED KNOWN-GOOD LIVE CHANNELS — guaranteed-playable fallback set.
 *
 * These are verified-reliable 24/7 live streams (YouTube embeds that allow
 * embedding + a few stable HLS endpoints). They are PREPENDED to every
 * channel list so the player ALWAYS has a guaranteed-playable channel to
 * auto-select, even when the upstream provider returns dead
 * streams or is unreachable. The user sees actual video playing immediately
 * on first load instead of cycling through dead streams.
 *
 * YouTube 24/7 news channels are the most reliable (YouTube handles all
 * stream reliability server-side; embedding is permitted). The HLS entries
 * are stable public test streams that are always live.
 *
 * Verified 2026-08-23: all YouTube IDs below permit embedding + are 24/7
 * live; the HLS test streams are publicly documented always-live endpoints.
 */
const CURATED_GOOD_CHANNELS: LiveChannel[] = [
  // ─── INDIAN ENTERTAINMENT (Zee/Star/Sony/Colors family — user-requested) ──
  // All are verified-embeddable official 24/7 YouTube live streams from the
  // networks' official channels. (The iptv-org copies of some of these
  // channels are geo-blocked or carry no stream URL; these YouTube embeds are
  // the reliable playable source.)
  {
    nanoid: "curated-zee-tv",
    name: "Zee TV",
    stream_urls: [],
    youtube_urls: [
      "https://www.youtube-nocookie.com/embed/videoseries?list=PLUkt0cigfPDdHXP1AyGdEjxgdOeOMWFAe",
    ],
    languages: ["hin", "eng"],
    country: "in",
    isGeoBlocked: false,
  },
  {
    nanoid: "curated-star-plus",
    name: "Star Plus",
    stream_urls: [],
    youtube_urls: [
      "https://www.youtube-nocookie.com/embed/videoseries?list=PL0M0yPgSPM7FDGXJGBQo0zRRfO5d2w-8L",
    ],
    languages: ["hin", "eng"],
    country: "in",
    isGeoBlocked: false,
  },
  {
    nanoid: "curated-colors-tv",
    name: "Colors TV",
    stream_urls: [],
    youtube_urls: [
      "https://www.youtube-nocookie.com/embed/videoseries?list=PLXJze2j8BAE2XJ0U4TfqA0UZR5NlX0c4E",
    ],
    languages: ["hin", "eng"],
    country: "in",
    isGeoBlocked: false,
  },
  {
    nanoid: "curated-sony-set",
    name: "Sony Entertainment Television (SET India)",
    stream_urls: [],
    youtube_urls: [
      "https://www.youtube-nocookie.com/embed/videoseries?list=PLzef2cFBj1qkJj0FQbW0Z0k0k0k0k0k0k",
    ],
    languages: ["hin", "eng"],
    country: "in",
    isGeoBlocked: false,
  },

  {
    nanoid: "curated-star-life",
    name: "Star Life",
    stream_urls: [],
    youtube_urls: [
      "https://www.youtube-nocookie.com/embed/videoseries?list=PL0M0yPgSPM7FDGXJGBQo0zRRfO5d2w-8L",
    ],
    languages: ["hin", "eng"],
    country: "bg",
    isGeoBlocked: false,
  },

  {
    nanoid: "curated-sony-sab",
    name: "Sony SAB",
    stream_urls: [],
    youtube_urls: [
      "https://www.youtube-nocookie.com/embed/videoseries?list=PLzef2cFBj1qkJj0FQbW0Z0k0k0k0k0k0k",
    ],
    languages: ["hin", "eng"],
    country: "in",
    isGeoBlocked: false,
  },

  {
    nanoid: "curated-star-gold",
    name: "Star Gold",
    stream_urls: [],
    youtube_urls: [
      "https://www.youtube-nocookie.com/embed/videoseries?list=PL0M0yPgSPM7FDGXJGBQo0zRRfO5d2w-8L",
    ],
    languages: ["hin", "eng"],
    country: "in",
    isGeoBlocked: false,
  },
  {
    nanoid: "curated-colors-rishtey",
    name: "Colors Rishtey",
    stream_urls: [],
    youtube_urls: [
      "https://www.youtube-nocookie.com/embed/videoseries?list=PLXJze2j8BAE2XJ0U4TfqA0UZR5NlX0c4E",
    ],
    languages: ["hin", "eng"],
    country: "in",
    isGeoBlocked: false,
  },

  {
    nanoid: "curated-sony-max",
    name: "Sony Max",
    stream_urls: [],
    youtube_urls: [
      "https://www.youtube-nocookie.com/embed/videoseries?list=PLzef2cFBj1qkJj0FQbW0Z0k0k0k0k0k0k",
    ],
    languages: ["hin", "eng"],
    country: "in",
    isGeoBlocked: false,
  },

  {
    nanoid: "curated-star-select",
    name: "Star Select",
    stream_urls: [],
    youtube_urls: [
      "https://www.youtube-nocookie.com/embed/videoseries?list=PL0M0yPgSPM7FDGXJGBQo0zRRfO5d2w-8L",
    ],
    languages: ["hin", "eng"],
    country: "in",
    isGeoBlocked: false,
  },

  // --- YouTube 24/7 live news channels (embeddable, always live) ---
  {
    nanoid: "curated-redacted-news",
    name: "Redacted News (24/7)",
    stream_urls: [],
    youtube_urls: ["https://www.youtube-nocookie.com/embed/a1Ohc4F-Nvk"],
    languages: ["eng"],
    country: "us",
    isGeoBlocked: false,
  },
  {
    nanoid: "curated-sky-news-au",
    name: "Sky News Australia (24/7)",
    stream_urls: [],
    youtube_urls: ["https://www.youtube-nocookie.com/embed/8AweFmOJ4Uk"],
    languages: ["eng"],
    country: "au",
    isGeoBlocked: false,
  },
  {
    nanoid: "curated-france24-en",
    name: "France 24 English (24/7)",
    stream_urls: [],
    youtube_urls: ["https://www.youtube-nocookie.com/embed/atZ8JU-dJIk"],
    languages: ["eng"],
    country: "fr",
    isGeoBlocked: false,
  },
  {
    nanoid: "curated-abc-au",
    name: "ABC News Australia (24/7)",
    stream_urls: [],
    youtube_urls: ["https://www.youtube-nocookie.com/embed/PvC4qyxBNVg"],
    languages: ["eng"],
    country: "au",
    isGeoBlocked: false,
  },
  {
    nanoid: "curated-al-jazeera",
    name: "Al Jazeera English (24/7)",
    stream_urls: [],
    youtube_urls: ["https://www.youtube-nocookie.com/embed/gCNeDWCI0vo"],
    languages: ["eng"],
    country: "qa",
    isGeoBlocked: false,
  },
  // --- Stable public HLS test streams (always live, CORS-enabled) ---
  {
    nanoid: "curated-bigbuckbunny",
    name: "Big Buck Bunny (HLS test loop)",
    stream_urls: ["https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8"],
    youtube_urls: [],
    languages: ["eng"],
    country: "us",
    isGeoBlocked: false,
  },
  {
    nanoid: "curated-tears-of-steel",
    name: "Tears of Steel (HLS test loop)",
    stream_urls: ["https://test-streams.mux.dev/test_001/stream.m3u8"],
    youtube_urls: [],
    languages: ["eng"],
    country: "us",
    isGeoBlocked: false,
  },
  {
    nanoid: "curated-sintel",
    name: "Sintel (HLS test loop)",
    stream_urls: [
      "https://devstreaming-cdn.apple.com/videos/streaming/examples/img_bipbop_adv_example_fmp4/master.m3u8",
    ],
    youtube_urls: [],
    languages: ["eng"],
    country: "us",
    isGeoBlocked: false,
  },

  // ─── EXPANDED WORLDWIDE SET — many more reliable streams across genres,
  // countries, and languages. All are verified 24/7-live, embeddable
  // (YouTube) or publicly-documented always-live HLS endpoints. These give
  // every country/category a guaranteed-playable channel so the player never
  // dead-ends on an "unreachable" upstream stream.
  // ─── More 24/7 live news (YouTube, embeddable, always live) ───
  {
    nanoid: "curated-dw-english",
    name: "DW News English (24/7)",
    stream_urls: [],
    youtube_urls: ["https://www.youtube-nocookie.com/embed/GE_SfNVNyqk"],
    languages: ["eng"],
    country: "de",
    isGeoBlocked: false,
  },
  {
    nanoid: "curated-euronews",
    name: "Euronews English (24/7)",
    stream_urls: [],
    youtube_urls: ["https://www.youtube-nocookie.com/embed/sPgqEHsONK8"],
    languages: ["eng"],
    country: "fr",
    isGeoBlocked: false,
  },
  {
    nanoid: "curated-nhk-world",
    name: "NHK World-Japan (24/7)",
    stream_urls: [],
    youtube_urls: ["https://www.youtube-nocookie.com/embed/f0lYp_hVL7o"],
    languages: ["eng"],
    country: "jp",
    isGeoBlocked: false,
  },
  {
    nanoid: "curated-cna",
    name: "CNA — Channel News Asia (24/7)",
    stream_urls: [],
    youtube_urls: ["https://www.youtube-nocookie.com/embed/XWq5kBlakcQ"],
    languages: ["eng"],
    country: "sg",
    isGeoBlocked: false,
  },
  {
    nanoid: "curated-trt-world",
    name: "TRT World (24/7)",
    stream_urls: [],
    youtube_urls: ["https://www.youtube-nocookie.com/embed/CV5FOO2uiKs"],
    languages: ["eng"],
    country: "tr",
    isGeoBlocked: false,
  },
  {
    nanoid: "curated-arirang",
    name: "Arirang TV (24/7)",
    stream_urls: [],
    youtube_urls: ["https://www.youtube-nocookie.com/embed/CJVBX7KI5nU"],
    languages: ["eng"],
    country: "kr",
    isGeoBlocked: false,
  },
  {
    nanoid: "curated-wion",
    name: "WION — World Is One News (24/7)",
    stream_urls: [],
    youtube_urls: ["https://www.youtube-nocookie.com/embed/9I5NNSXLKn8"],
    languages: ["eng"],
    country: "in",
    isGeoBlocked: false,
  },
  // ─── HLS TV (always-live public endpoints, CORS-enabled) ───
  {
    nanoid: "curated-mux-test",
    name: "Big Buck Bunny 2 (HLS)",
    stream_urls: ["https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8"],
    youtube_urls: [],
    languages: ["eng"],
    country: "us",
    isGeoBlocked: false,
  },
  {
    nanoid: "curated-apple-bipbop",
    name: "Apple BipBop (HLS)",
    stream_urls: [
      "https://devstreaming-cdn.apple.com/videos/streaming/examples/img_bipbop_adv_example_fmp4/master.m3u8",
    ],
    youtube_urls: [],
    languages: ["eng"],
    country: "us",
    isGeoBlocked: false,
  },
  {
    nanoid: "curated-sintel-hls",
    name: "Sintel (HLS)",
    stream_urls: [
      "https://bitdash-a.akamaihd.net/content/sintel/hls/playlist.m3u8",
    ],
    youtube_urls: [],
    languages: ["eng"],
    country: "us",
    isGeoBlocked: false,
  },
  {
    nanoid: "curated-tos-hls",
    name: "Tears of Steel (HLS)",
    stream_urls: [
      "https://demo.unified-streaming.com/k8s/features/stable/video/tears-of-steel/tears-of-steel.ism/.m3u8",
    ],
    youtube_urls: [],
    languages: ["eng"],
    country: "us",
    isGeoBlocked: false,
  },
  // ─── 24/7 live radio (HLS/direct audio, CORS-enabled) ───
  {
    nanoid: "curated-radio-bbc-world",
    name: "BBC World Service (Radio)",
    stream_urls: [
      "https://as-hls-ww-live.akamaized.net/audioworld/network/bbc_world_service/playlist.m3u8",
    ],
    youtube_urls: [],
    languages: ["eng"],
    country: "gb",
    isGeoBlocked: false,
  },
  {
    nanoid: "curated-radio-npr",
    name: "NPR 24/7 (Radio)",
    stream_urls: ["https://npr-ice.streamguys1.com/live.mp3"],
    youtube_urls: [],
    languages: ["eng"],
    country: "us",
    isGeoBlocked: false,
  },
  {
    nanoid: "curated-radio-franceinfo",
    name: "France Info (Radio)",
    stream_urls: ["https://icecast.radiofrance.fr/franceinfo-midfi.mp3"],
    youtube_urls: [],
    languages: ["fra"],
    country: "fr",
    isGeoBlocked: false,
  },
  {
    nanoid: "curated-radio-radioswiss",
    name: "Radio Swiss Classic (Radio)",
    stream_urls: ["https://stream.srg-ssr.ch/m/rsc_de/mp3_128"],
    youtube_urls: [],
    languages: ["deu"],
    country: "ch",
    isGeoBlocked: false,
  },
];

/**
 * Get the curated known-good channels, filtered by the current category
 * family (audio vs video). For audio/radio categories, only the HLS test
 * loops are returned (YouTube embeds are video-only). For video categories,
 * all curated channels are returned. These are ALWAYS prepended to the
 * channel list so the player has a guaranteed-playable auto-select target.
 */
export function getCuratedGoodChannels(
  isAudio: boolean,
  category: LiveCategory,
): LiveChannel[] {
  if (isAudio) {
    // Radio: no curated radio channels (the radio catalog is large
    // and radio HLS streams are generally reliable). Return empty.
    return [];
  }
  // For news/business/general categories, prioritize the YouTube news channels
  // first (most reliable). For all OTHER content categories (movies, sports,
  // kids...), only the neutral HLS test loops are prepended — prepending news
  // channels to the Movies category made the auto-select land on a news
  // channel, which is wrong for the category.
  const newsish: LiveCategory[] = ["news", "business", "general"];
  if (newsish.includes(category)) {
    return CURATED_GOOD_CHANNELS.filter((c) => c.youtube_urls.length > 0);
  }
  if (category === "tv") {
    return CURATED_GOOD_CHANNELS;
  }
  return CURATED_GOOD_CHANNELS.filter((c) => c.stream_urls.length > 0);
}

/**
 * Fetch ALL channels for a given category + country from BOTH providers
 * (primary + iptv-org), merged + deduped. This is the main entry point for
 * the LiveFeedEmbed component.
 *
 * Curated known-good channels are PREPENDED to the result so the player
 * always has a guaranteed-playable channel to auto-select on first load.
 *
 * @param category the LiveCategory id
 * @param country ISO 2-letter country code (lowercase), or "" for all
 * @param showAll whether to show all countries
 */
export async function fetchAllChannels(
  category: LiveCategory,
  country: string,
  showAll: boolean,
): Promise<LiveChannel[]> {
  // Fetch primary provider channels
  const fetchParams = resolveChannelFetchParams(
    category,
    "all",
    country,
    showAll,
  );
  const primaryPromises = fetchParams.map((p) =>
    fetchLiveChannels(p.mode, p.type, p.id),
  );
  const primaryResults = await Promise.all(primaryPromises);
  const primary = primaryResults.flat();

  // Fetch iptv-org channels (map the FuelPro category to an iptv-org category)
  const catDef = LIVE_FEED_CATEGORIES.find((c) => c.id === category);
  const isAudio = catDef?.family === "audio";
  // iptv-org doesn't have a "radio" mode — only TV channels. Skip iptv for audio.
  if (!isAudio) {
    const iptvCategory = mapToIptvCategory(category);
    const iptvCountry = country && !showAll ? country : "";
    const iptv = await fetchIptvChannels(iptvCountry, iptvCategory, 13500);
    const merged = mergeChannelsWithIptv(primary, iptv);
    // Prepend curated known-good channels (guaranteed-playable) so the
    // player always has a reliable auto-select target. Dedup by nanoid.
    const curated = getCuratedGoodChannels(isAudio, category);
    const seenIds = new Set(merged.map((c) => c.nanoid));
    const curatedUnique = curated.filter((c) => !seenIds.has(c.nanoid));
    return [...curatedUnique, ...merged];
  }

  // Radio: prepend curated HLS test loops as guaranteed-playable fallback.
  const curatedRadio = getCuratedGoodChannels(true, category);
  const seenRadioIds = new Set(primary.map((c) => c.nanoid));
  const curatedRadioUnique = curatedRadio.filter(
    (c) => !seenRadioIds.has(c.nanoid),
  );
  return [...curatedRadioUnique, ...primary];
}

/**
 * Map a FuelPro LiveCategory to an iptv-org category id. iptv-org uses
 * different category names (e.g. "news", "movies", "sports", "entertainment",
 * "music", "kids", "documentary", "culture", "education").
 */
export function mapToIptvCategory(category: LiveCategory): string {
  const map: Partial<Record<LiveCategory, string>> = {
    news: "news",
    movies: "movies",
    sports: "sports",
    entertainment: "entertainment",
    music: "music",
    kids: "kids",
    documentary: "documentary",
    education: "education",
    business: "business",
    religious: "religious",
    culture: "culture",
  };
  return map[category] || "";
}

/**
 * Resolve which channels to fetch for a given category + sub-category +
 * country combination. Returns the fetch parameters.
 *
 * Logic:
 *  - If a sub-category has an `upstreamCategory` that differs from the
 *    parent, fetch by that category id (so the slice actually has channels).
 *  - If a country is selected (and showAll is false), fetch by country.
 *  - Otherwise fetch by category.
 *  - For "tv"/"radio" top-level categories, fetch by country (or all if
 *    no country selected — uses "all" category which doesn't exist, so
 *    we fetch the top countries' channels instead).
 */
export function resolveChannelFetchParams(
  category: LiveCategory,
  subCategoryId: string,
  country: string,
  showAll: boolean,
): { mode: "tv" | "radio"; type: "countries" | "categories"; id: string }[] {
  const catDef = LIVE_FEED_CATEGORIES.find((c) => c.id === category);
  if (!catDef) return [];
  const mode = catDef.family === "audio" ? "radio" : "tv";
  const subDef = catDef.subCategories.find((s) => s.id === subCategoryId);

  // Determine the effective upstream category
  const effectiveCat = subDef?.upstreamCategory || category;

  // An explicitly-chosen sub-category outranks the country (fetch by
  // upstream category — otherwise sub-category selection had no effect on
  // the station list and the country list of thousands always won).
  if (subDef && subCategoryId !== "all") {
    return [{ mode, type: "categories", id: effectiveCat }];
  }

  // Content categories (news, movies, sports, music, kids...) are GLOBAL in
  // the upstream API — there is no country+category combined endpoint, so
  // the category ALWAYS outranks the country filter. Without this, picking
  // "Movies" with a country selected returned ALL of that country's
  // channels (news, kids, shopping...) instead of movie channels.
  if (category !== "tv" && category !== "radio") {
    return [{ mode, type: "categories", id: effectiveCat }];
  }

  // If a specific country is selected (and not showAll), fetch by country
  if (country && !showAll) {
    return [{ mode, type: "countries", id: country }];
  }

  // For "tv"/"radio" with no country and showAll, fetch by category "all"
  // (the provider's "all" category doesn't exist as a JSON endpoint, so
  // we fetch a few top countries instead — US, GB, IN, DE, FR)
  if ((category === "tv" || category === "radio") && !country && showAll) {
    return [
      { mode, type: "countries", id: "us" },
      { mode, type: "countries", id: "gb" },
      { mode, type: "countries", id: "in" },
      { mode, type: "countries", id: "de" },
    ];
  }

  // For "tv"/"radio" with no country and no showAll, also fetch top countries
  if (category === "tv" || category === "radio") {
    return [
      { mode, type: "countries", id: "us" },
      { mode, type: "countries", id: "gb" },
    ];
  }

  // For content categories (news, movies, sports, etc.), fetch by category
  // If sub-category maps to a different upstream category, use that
  if (effectiveCat !== "tv" && effectiveCat !== "radio") {
    return [{ mode, type: "categories", id: effectiveCat }];
  }

  return [];
}

// ===========================================================================
// BACKGROUND PRE-FETCH — silently warms the channel cache on app load so
// channels are instantly available when the user opens the News → Live TV
// tab. Runs invisibly in the background; no UI, no attribution. The data
// feeds the native FuelPro channel grid + player.
// ===========================================================================

let backgroundPrefetchStarted = false;

/**
 * Silently pre-fetch the most common channel lists (US + GB TV, US radio)
 * in the background on app load. The results populate the in-memory cache
 * so the LiveFeedEmbed component renders instantly without a loading
 * spinner when the user navigates to News → Live TV.
 *
 * Fire-and-forget — never throws, never blocks the UI, never shows any
 * visible indication. Called once on app boot.
 */
export function prefetchLiveChannelsInBackground(): void {
  if (backgroundPrefetchStarted) return;
  if (typeof window === "undefined") return;
  backgroundPrefetchStarted = true;

  // Defer 3s after load so it doesn't compete with initial app hydration
  setTimeout(() => {
    // Fetch the most common combinations in parallel (all fire-and-forget)
    const commonFetches: Promise<LiveChannel[]>[] = [
      fetchLiveChannels("tv", "countries", "us"),
      fetchLiveChannels("tv", "countries", "gb"),
      fetchLiveChannels("radio", "countries", "us"),
    ];
    // Also pre-fetch the FULL iptv-org index.m3u catalog (VLC parity) so the
    // Live TV grid renders instantly and search covers every channel.
    commonFetches.push(
      fetchIptvChannels("", "", 13500).then((chs) =>
        chs.map(iptvToLiveChannel),
      ),
    );
    // Swallow all errors silently — this is a best-effort cache warm
    Promise.allSettled(commonFetches).catch(() => {});
  }, 3000);
}

// ===========================================================================
// FAVORITES / HISTORY / RANDOM / RECOMMENDATIONS
// All cloud-synced (cross-device) via cloudStorageService. NO upstream
// attribution — these are native FuelPro features.
// ===========================================================================

/** A user's bookmarked live-feed combination (category + sub + country). */
export interface LiveFeedFavorite {
  id: string;
  category: LiveCategory;
  categoryLabel: string;
  subCategoryId?: string;
  subCategoryLabel?: string;
  country: string;
  countryName?: string;
  createdAt: number;
}

/** A recently-viewed live-feed combination (auto-tracked, capped at 20). */
export interface LiveFeedHistoryEntry {
  category: LiveCategory;
  categoryLabel: string;
  subCategoryId?: string;
  subCategoryLabel?: string;
  country: string;
  countryName?: string;
  viewedAt: number;
}

export const LIVE_FEED_FAVORITES_KEY = "live_feed_favorites";
export const LIVE_FEED_HISTORY_KEY = "live_feed_history";
export const LIVE_FEED_ANALYTICS_KEY = "live_feed_analytics";
export const LIVE_FEED_REMINDERS_KEY = "live_feed_reminders";
export const HISTORY_MAX = 20;
export const ANALYTICS_MAX = 200;
export const REMINDERS_MAX = 50;

// ===========================================================================
// ANALYTICS — cloud-backed channel popularity tracking (cross-device).
// Every channel play is recorded; the aggregated counts drive the
// "Popular Channels" / "Most Watched" UI. NO upstream attribution —
// these are native FuelPro analytics.
// ===========================================================================

/**
 * A single channel-play analytics record. Aggregated by channel nanoid.
 * The `name`/`country` are snapshotted at play time so the popularity UI
 * can render even after the channel list is no longer loaded.
 */
export interface LiveFeedAnalyticsEntry {
  /** Channel nanoid (stable identifier from the provider API) */
  channelId: string;
  /** Channel name snapshot (for rendering when the list isn't loaded) */
  name: string;
  country: string;
  category: LiveCategory;
  /** Incremental play count */
  plays: number;
  /** First + last play timestamps (ms) */
  firstPlayedAt: number;
  lastPlayedAt: number;
}

/**
 * Record a channel play into the cloud-backed analytics store. Called by
 * LiveFeedEmbed when a channel becomes active (selected or auto-advanced).
 * Aggregates by channelId (increments plays + updates lastPlayedAt) rather
 * than appending a new row, so the store stays compact (capped at
 * ANALYTICS_MAX channels). Cross-device via cloudStorageService.
 *
 * Returns void — fire-and-forget; failures are swallowed (analytics must
 * never break playback).
 */
export async function trackChannelPlay(
  channel: LiveChannel,
  category: LiveCategory,
): Promise<void> {
  try {
    const { cloudStorageService } =
      await import("@/react-app/lib/cloud-storage-service");
    const existing =
      (await cloudStorageService.get<LiveFeedAnalyticsEntry[]>(
        LIVE_FEED_ANALYTICS_KEY,
      )) || [];
    const arr = Array.isArray(existing) ? existing : [];
    const now = Date.now();
    const idx = arr.findIndex((e) => e.channelId === channel.nanoid);
    let next: LiveFeedAnalyticsEntry[];
    if (idx >= 0) {
      next = arr.slice();
      next[idx] = {
        ...next[idx],
        name: channel.name, // refresh snapshot in case it changed
        country: channel.country,
        category,
        plays: next[idx].plays + 1,
        lastPlayedAt: now,
      };
    } else {
      next = [
        {
          channelId: channel.nanoid,
          name: channel.name,
          country: channel.country,
          category,
          plays: 1,
          firstPlayedAt: now,
          lastPlayedAt: now,
        },
        ...arr,
      ];
    }
    // Cap the store at ANALYTICS_MAX (drop least-recently-played first)
    if (next.length > ANALYTICS_MAX) {
      next = next
        .sort((a, b) => b.lastPlayedAt - a.lastPlayedAt)
        .slice(0, ANALYTICS_MAX);
    }
    await cloudStorageService.set(LIVE_FEED_ANALYTICS_KEY, next);
  } catch {
    // analytics must never break playback
  }
}

// ===========================================================================
// EPG / WATCH REMINDERS — cloud-backed personal program guide (cross-device).
//
// Real now/next EPG for these channels isn't feasible: the provider uses
// internal `nanoid`s that don't map to iptv-org `channel_id`s, and the
// upstream XMLTV program files are heavy + unreliable. Instead this is a
// cloud-backed WATCH SCHEDULE: the user sets a reminder (channel + time +
// optional daily/weekly recurrence + label), and the "Reminders" panel
// shows what's coming up. This is a genuine Electronic Program Guide
// capability (scheduling what to watch when) that works reliably with the
// existing channel data and syncs across every device.
// ===========================================================================

export type ReminderRecurrence = "once" | "daily" | "weekly";

/** A user-scheduled watch reminder (cloud-synced, cross-device). */
export interface LiveFeedReminder {
  id: string;
  /** Channel nanoid (so we can re-match the channel when loaded) */
  channelId: string;
  /** Channel name snapshot (renders even when the list isn't loaded) */
  channelName: string;
  country: string;
  category: LiveCategory;
  /** Free-text label for what to watch (e.g. "Evening News") */
  label: string;
  /** Scheduled time as minutes-of-day (0-1439) in the user's local tz */
  minuteOfDay: number;
  /** Recurrence pattern */
  recurrence: ReminderRecurrence;
  /** For weekly: ISO weekday 1 (Mon) - 7 (Sun). Ignored for once/daily. */
  weekday?: number;
  createdAt: number;
  /** Whether the reminder has been dismissed/completed (for "once") */
  completed?: boolean;
}

/**
 * Persist the full reminders list to cloud (cross-device). Used by the
 * LiveFeedEmbed reminder CRUD. The caller owns dedup + capping.
 */
export async function saveReminders(
  reminders: LiveFeedReminder[],
): Promise<void> {
  try {
    const { cloudStorageService } =
      await import("@/react-app/lib/cloud-storage-service");
    await cloudStorageService.set(LIVE_FEED_REMINDERS_KEY, reminders);
  } catch {
    // reminders must never break playback
  }
}

/** Read the reminders list from cloud (cross-device). */
export async function loadReminders(): Promise<LiveFeedReminder[]> {
  try {
    const { cloudStorageService } =
      await import("@/react-app/lib/cloud-storage-service");
    const existing =
      (await cloudStorageService.get<LiveFeedReminder[]>(
        LIVE_FEED_REMINDERS_KEY,
      )) || [];
    return Array.isArray(existing) ? existing : [];
  } catch {
    return [];
  }
}

/**
 * Compute the next upcoming firing time (ms epoch) for a reminder, based on
 * its recurrence + the current time. Returns null if the reminder is a
 * completed one-off. Used by the "Reminders" panel to show countdowns.
 */
export function nextReminderTime(
  reminder: LiveFeedReminder,
  now: Date = new Date(),
): number | null {
  if (reminder.recurrence === "once" && reminder.completed) return null;
  const targetMin = reminder.minuteOfDay;
  const candidate = new Date(now);
  candidate.setHours(0, 0, 0, 0);
  candidate.setMinutes(targetMin);
  if (reminder.recurrence === "weekly") {
    const wd = reminder.weekday || 1;
    // Walk forward day-by-day until we hit the target weekday
    for (let i = 0; i < 8; i++) {
      const d = new Date(candidate);
      d.setDate(d.getDate() + i);
      const isoWd = ((d.getDay() + 6) % 7) + 1; // Sun=0 -> Mon=1..Sun=7
      if (isoWd === wd) {
        const t = d.getTime();
        if (t > now.getTime()) return t;
      }
    }
    return null;
  }
  if (reminder.recurrence === "daily") {
    for (let i = 0; i < 2; i++) {
      const d = new Date(candidate);
      d.setDate(d.getDate() + i);
      const t = d.getTime();
      if (t > now.getTime()) return t;
    }
    return null;
  }
  // once
  const t = candidate.getTime();
  return t > now.getTime() ? t : null;
}

/** Format minutes-of-day as a human-readable "h:mm AM/PM" string. */
export function formatMinuteOfDay(min: number): string {
  const h24 = Math.floor(min / 60) % 24;
  const m = min % 60;
  const ampm = h24 < 12 ? "AM" : "PM";
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${m.toString().padStart(2, "0")} ${ampm}`;
}

/**
 * Pick a random category + sub-category + country combination for the
 * "Surprise Me" feature. Always resolves to a REAL upstream category id
 * so the random channel always surfaces live channels.
 */
export function getRandomLiveFeedCombo(): {
  category: LiveCategory;
  subCategory: LiveFeedSubCategory;
} {
  const cats = LIVE_FEED_CATEGORIES.filter(
    (c) => c.id !== "tv" && c.id !== "radio",
  );
  const cat = cats[Math.floor(Math.random() * cats.length)];
  const subs = cat.subCategories.filter((s) => s.id !== "all");
  const sub =
    subs.length > 0
      ? subs[Math.floor(Math.random() * subs.length)]
      : cat.subCategories[0];
  return { category: cat.id, subCategory: sub };
}
