/**
 * B3: an agent's language config (`agent_defs.language_config`) is free text —
 * the admin editor's field is a plain input placeholdered "e.g. Ukrainian".
 * The keyword half of `hybridSearch` needs a Postgres *text-search config*
 * (a `regconfig`: `'english'`, `'spanish'`, …) to stem the query and the
 * document the same way. This resolves one to the other.
 *
 * Rules:
 *   - nothing configured            → `'english'`  (byte-identical to B1)
 *   - a recognised language / code  → its Postgres config
 *   - anything else (incl. languages Postgres has no stemmer for, e.g.
 *     Ukrainian) → `'simple'` — lowercase + split, no stopwords, no stemming.
 *     Safe for any script and never wrong; just less recall than a real stemmer.
 *
 * The returned value is always one of Postgres's 29 built-in configs, so
 * callers may inline it into SQL (it is never attacker-controlled once it has
 * been through here).
 */

/** Postgres's built-in text-search configs (`SELECT cfgname FROM pg_ts_config`), plus `simple`. */
const PG_CONFIGS = new Set([
  "arabic", "armenian", "basque", "catalan", "danish", "dutch", "english", "finnish", "french",
  "german", "greek", "hindi", "hungarian", "indonesian", "irish", "italian", "lithuanian", "nepali",
  "norwegian", "portuguese", "romanian", "russian", "serbian", "simple", "spanish", "swedish",
  "tamil", "turkish", "yiddish",
]);

/** ISO 639-1 codes and common endonyms → Postgres config. Only languages Postgres actually ships a config for. */
const ALIASES: Record<string, string> = {
  ar: "arabic", "العربية": "arabic",
  hy: "armenian",
  eu: "basque", euskara: "basque",
  ca: "catalan", "català": "catalan",
  da: "danish", dansk: "danish",
  nl: "dutch", nederlands: "dutch", flemish: "dutch",
  en: "english",
  fi: "finnish", suomi: "finnish",
  fr: "french", "français": "french", francais: "french",
  de: "german", deutsch: "german",
  el: "greek", "ελληνικά": "greek",
  hi: "hindi", "हिन्दी": "hindi",
  hu: "hungarian", magyar: "hungarian",
  id: "indonesian", "bahasa indonesia": "indonesian",
  ga: "irish", gaeilge: "irish",
  it: "italian", italiano: "italian",
  lt: "lithuanian",
  ne: "nepali",
  no: "norwegian", nb: "norwegian", nn: "norwegian", norsk: "norwegian", "bokmål": "norwegian",
  pt: "portuguese", "português": "portuguese", portugues: "portuguese", "pt-br": "portuguese",
  ro: "romanian", "română": "romanian",
  ru: "russian", "русский": "russian",
  sr: "serbian", "српски": "serbian",
  es: "spanish", "español": "spanish", espanol: "spanish", castellano: "spanish",
  sv: "swedish", svenska: "swedish",
  ta: "tamil",
  tr: "turkish", "türkçe": "turkish", turkce: "turkish",
  yi: "yiddish",
};

export function resolveTextSearchConfig(language?: string | null): string {
  const key = language?.trim().toLowerCase();
  if (!key) return "english";
  if (PG_CONFIGS.has(key)) return key;
  if (ALIASES[key]) return ALIASES[key];
  return "simple";
}
