/**
 * Curated font allowlist for widget theming — a fixed set of {css, googleFontsUrl} pairs
 * rather than a free-text field, so an admin-chosen font can never inject arbitrary CSS or
 * an arbitrary stylesheet URL. Shared by the embed page (loads the stylesheet + applies the
 * CSS) and the admin editor/mock preview (renders the picker + the same live preview).
 */
export const WIDGET_FONTS = {
  inter: { label: "Inter (default)", css: "var(--font-sans)" },
  system: { label: "System UI", css: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" },
  roboto: { label: "Roboto", css: "'Roboto', sans-serif", googleFontsUrl: "https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;600&display=swap" },
  poppins: { label: "Poppins", css: "'Poppins', sans-serif", googleFontsUrl: "https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600&display=swap" },
  lora: { label: "Lora (serif)", css: "'Lora', serif", googleFontsUrl: "https://fonts.googleapis.com/css2?family=Lora:wght@400;500;600&display=swap" },
  jetbrains_mono: { label: "JetBrains Mono", css: "'JetBrains Mono', monospace", googleFontsUrl: "https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500&display=swap" },
} as const;

export type WidgetFontKey = keyof typeof WIDGET_FONTS;

export function isWidgetFontKey(value: string): value is WidgetFontKey {
  return value in WIDGET_FONTS;
}
