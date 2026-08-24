// Quicky — applies the user's persisted theme to the DOM.
// Themes are defined as [data-theme] CSS-variable overrides in globals.css.
export const THEME_IDS = ['dark', 'light', 'midnight', 'coral', 'lavender', 'gold'] as const
export type ThemeId = (typeof THEME_IDS)[number]

export function applyThemeToDOM(theme?: string | null) {
  if (typeof document === 'undefined') return
  const id = THEME_IDS.includes(theme as ThemeId) ? (theme as ThemeId) : 'dark'
  document.documentElement.dataset.theme = id
}
