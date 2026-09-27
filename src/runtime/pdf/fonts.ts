// Maps the CSS font strings the element renderers set (`ctx.font = '700 32px Arial'`,
// `'bold 10px sans-serif'`, ...) onto the PDF standard fonts jsPDF ships with, which need no embedding.
// Arial/Helvetica, Times New Roman/Times and Courier New/Courier share character widths pairwise, so
// text laid out with the browser's font lands in the same place in the PDF. Georgia and Verdana have
// no standard-font equivalent: TextProps.tsx no longer offers them, and existing templates that still
// use them fall back to Times/Helvetica here (their lines were wrapped with the wider browser font,
// so they still fit their boxes).

export interface ParsedFont {
  sizePx: number
  bold: boolean
  italic: boolean
  family: string
}

export type PdfFontName = 'helvetica' | 'times' | 'courier'
export type PdfFontStyle = 'normal' | 'bold' | 'italic' | 'bolditalic'

const DEFAULT_FONT: ParsedFont = { sizePx: 10, bold: false, italic: false, family: 'sans-serif' }

// Only the shorthand forms this widget itself produces need to parse: optional style/weight tokens,
// a px size (optionally with a /line-height), then the family list.
export function parseCssFont (font: string): ParsedFont {
  const match = /^\s*(.*?)\s*(\d+(?:\.\d+)?)px(?:\/\S+)?\s+(.+?)\s*$/.exec(font ?? '')
  if (!match) return DEFAULT_FONT
  const [, prefix, size, family] = match
  const tokens = prefix.toLowerCase().split(/\s+/).filter(Boolean)
  return {
    sizePx: Number(size),
    italic: tokens.includes('italic') || tokens.includes('oblique'),
    bold: tokens.some((token) => token === 'bold' || token === 'bolder' || (/^\d{3}$/.test(token) && Number(token) >= 600)),
    family
  }
}

export function toPdfFont (font: ParsedFont): { name: PdfFontName; style: PdfFontStyle } {
  const first = font.family.split(',')[0].trim().replace(/^["']|["']$/g, '').toLowerCase()
  const name: PdfFontName = /^(times|georgia|serif$)/.test(first)
    ? 'times'
    : /^(courier|monospace$)/.test(first)
      ? 'courier'
      : 'helvetica'
  const style: PdfFontStyle = font.bold && font.italic ? 'bolditalic' : font.bold ? 'bold' : font.italic ? 'italic' : 'normal'
  return { name, style }
}

// The standard fonts only cover the WinAnsi (Windows-1252) character set: printable ASCII, Latin-1,
// and these typographic extras. Text with anything else (macrons, most of Latin Extended-A, Greek,
// CJK, ...) cannot be written with them, so pdfPainter.ts draws such a run as a high-resolution image
// instead of emitting garbled characters.
const WIN_ANSI_EXTRAS = new Set('€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ')

export function isWinAnsiEncodable (text: string): boolean {
  for (const char of text) {
    const code = char.codePointAt(0)
    const isAscii = code >= 0x20 && code <= 0x7e
    const isLatin1 = code >= 0xa0 && code <= 0xff
    if (!isAscii && !isLatin1 && !WIN_ANSI_EXTRAS.has(char)) return false
  }
  return true
}
