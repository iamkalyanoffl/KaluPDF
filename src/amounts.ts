/** Flags numbers in OCR text that look like a misread amount. A warning only: it never changes the text. */
export function suspiciousAmounts(text: string): string[] {
  const out = new Set<string>()
  for (const m of text.matchAll(/(?<![\d.,])\d{5,}(?![\d.,])/g)) out.add(`${m[0]} is a long number with no comma or decimal point`)
  for (const m of text.matchAll(/(?<![\d.,])\d{1,3}(?:,\d{3})*,\d{1,2}(?![\d,])(?!\.\d)/g)) out.add(`${m[0]} has an odd comma`)
  for (const m of text.matchAll(/(?<![\d.,])\d+,\d{4,}(?![\d,])/g)) out.add(`${m[0]} has an odd comma`)
  return [...out]
}
