// The little of opentype.js (which ships no types) that scripts/optimize-cards.ts uses.
declare module 'opentype.js' {
  export interface Path {
    toPathData(decimalPlaces?: number): string
  }
  export interface Font {
    getPath(text: string, x: number, y: number, fontSize: number): Path
  }
  /** CommonJS: Node only offers it as a default export. */
  const opentype: { parse(buffer: ArrayBuffer): Font }
  export default opentype
}
