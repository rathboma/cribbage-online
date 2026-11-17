import { describe, expect, it } from 'vitest'
import { colors, contrastPairs, contrastRatio, installTokens, tokensCss } from './tokens'

describe('design tokens', () => {
  it.each(contrastPairs)('$fg on $bg meets WCAG AA ($min:1)', ({ fg, bg, min }) => {
    expect(contrastRatio(colors[fg], colors[bg])).toBeGreaterThanOrEqual(min)
  })

  it('computes contrast like the WCAG formula', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5)
    expect(contrastRatio('#777777', '#ffffff')).toBeCloseTo(4.48, 2)
  })

  it('exposes every token as a CSS custom property', () => {
    const css = tokensCss()
    expect(css).toContain('--color-felt: #1d4d34;')
    expect(css).toContain('--color-felt-dark: #123323;')
    expect(css).toContain('--space-4: 1rem;')
    expect(css).toContain('--radius-pill: 999px;')
  })

  it('installs the tokens into the document once', () => {
    installTokens(document)
    installTokens(document)
    expect(document.querySelectorAll('#design-tokens')).toHaveLength(1)
    expect(
      getComputedStyle(document.documentElement).getPropertyValue('--color-cream').trim(),
    ).toBe('#f7f1e3')
  })
})
