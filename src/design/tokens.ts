/**
 * Design tokens: the single source of truth for colours, type, spacing, radii and shadows.
 * They become CSS custom properties (`--color-felt`, `--space-4`, ...) on :root at startup, and
 * the 3D table (Phase 4) imports the same values so the DOM and the canvas match.
 */

export const colors = {
  /** The table: deep billiard-cloth green. */
  felt: '#1d4d34',
  feltDark: '#123323',
  feltLight: '#2c6a4a',
  /** The cribbage board. */
  wood: '#8b5a2b',
  woodDark: '#5e3a17',
  /** Card stock and light surfaces. */
  cream: '#f7f1e3',
  creamDark: '#e9dfc8',
  /** Body text and black suits. */
  ink: '#1c1b19',
  inkMuted: '#5a554b',
  /** Red suits. */
  cardRed: '#b3261e',
  /** The one accent: highlights, focus rings, the "beta" badge. */
  accent: '#e0a526',
  accentInk: '#3a2a05',
  /** Feedback. */
  danger: '#a61b1b',
  white: '#ffffff',
  /** Focus ring on light surfaces (the default). */
  focusLight: '#1c1b19',
  /** Focus ring on the felt and other dark surfaces (set with the `on-dark` class). */
  focusDark: '#e0a526',
} as const

export const fonts = {
  body: "system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
} as const

/** Type scale in rem (1rem = 16px). */
export const fontSizes = {
  xs: '0.75rem',
  sm: '0.875rem',
  md: '1rem',
  lg: '1.25rem',
  xl: '1.5rem',
  '2xl': '2rem',
  display: '2.75rem',
} as const

export const space = {
  0: '0',
  1: '0.25rem',
  2: '0.5rem',
  3: '0.75rem',
  4: '1rem',
  5: '1.5rem',
  6: '2rem',
  7: '3rem',
  8: '4rem',
} as const

export const radii = {
  sm: '6px',
  md: '10px',
  lg: '16px',
  pill: '999px',
} as const

export const shadows = {
  sm: '0 1px 2px rgb(0 0 0 / 0.18)',
  md: '0 4px 12px rgb(0 0 0 / 0.22)',
  lg: '0 12px 32px rgb(0 0 0 / 0.3)',
} as const

/**
 * Every foreground/background pair the CSS uses, with the WCAG AA ratio it must meet: 4.5:1 for
 * text, 3:1 for controls and focus rings (WCAG 1.4.11). Keep this list in step with the styles.
 */
export const contrastPairs: { fg: keyof typeof colors; bg: keyof typeof colors; min: number }[] = [
  // Text
  { fg: 'ink', bg: 'cream', min: 4.5 },
  { fg: 'ink', bg: 'white', min: 4.5 }, // text inputs
  { fg: 'inkMuted', bg: 'cream', min: 4.5 },
  { fg: 'ink', bg: 'creamDark', min: 4.5 }, // neutral badge
  { fg: 'cream', bg: 'felt', min: 4.5 },
  { fg: 'cream', bg: 'feltDark', min: 4.5 },
  { fg: 'cream', bg: 'feltLight', min: 4.5 },
  { fg: 'cream', bg: 'ink', min: 4.5 }, // toasts
  { fg: 'accentInk', bg: 'accent', min: 4.5 },
  { fg: 'cardRed', bg: 'cream', min: 4.5 },
  { fg: 'cardRed', bg: 'white', min: 4.5 }, // red suits on cards
  { fg: 'danger', bg: 'cream', min: 4.5 },
  { fg: 'white', bg: 'danger', min: 4.5 },
  { fg: 'felt', bg: 'cream', min: 4.5 }, // secondary button text
  // Focus rings: ink on light surfaces, the accent on dark ones
  { fg: 'focusLight', bg: 'cream', min: 3 },
  { fg: 'focusLight', bg: 'white', min: 3 },
  { fg: 'focusLight', bg: 'creamDark', min: 3 },
  { fg: 'focusDark', bg: 'felt', min: 3 },
  { fg: 'focusDark', bg: 'feltDark', min: 3 },
  { fg: 'focusDark', bg: 'ink', min: 3 },
  // Control boundaries and states
  { fg: 'felt', bg: 'cream', min: 3 }, // checked switch track, secondary button border
  { fg: 'inkMuted', bg: 'cream', min: 3 }, // input and switch borders
  { fg: 'inkMuted', bg: 'creamDark', min: 3 }, // unchecked switch thumb border on its track
  { fg: 'white', bg: 'felt', min: 3 }, // checked switch thumb
]

const kebab = (name: string) => name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)

/** Every token as a CSS custom property declaration block for :root. */
export function tokensCss(): string {
  const lines = [
    ...Object.entries(colors).map(([k, v]) => `--color-${kebab(k)}: ${v};`),
    ...Object.entries(fonts).map(([k, v]) => `--font-${k}: ${v};`),
    ...Object.entries(fontSizes).map(([k, v]) => `--font-size-${k}: ${v};`),
    ...Object.entries(space).map(([k, v]) => `--space-${k}: ${v};`),
    ...Object.entries(radii).map(([k, v]) => `--radius-${k}: ${v};`),
    ...Object.entries(shadows).map(([k, v]) => `--shadow-${k}: ${v};`),
  ]
  return `:root {\n  ${lines.join('\n  ')}\n}\n`
}

/** Adds the tokens to the document, once. */
export function installTokens(doc: Document = document): void {
  if (doc.getElementById('design-tokens')) return
  const style = doc.createElement('style')
  style.id = 'design-tokens'
  style.textContent = tokensCss()
  doc.head.prepend(style)
}

/** WCAG relative luminance of a #rrggbb colour. */
export function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }) as [number, number, number]
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** WCAG contrast ratio between two #rrggbb colours (1 to 21). */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number]
  return (hi + 0.05) / (lo + 0.05)
}
