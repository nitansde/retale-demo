// Browsers already ship the complete HTML entity table. Decode only individual
// references in an inert attribute context, where ambiguous named references
// (for example &notit;) stay literal instead of partially decoding &not.
const references = /&(?:#[xX][\da-fA-F]+|#\d+|[a-zA-Z][a-zA-Z\d]*);/g
const cache = new Map<string, string>()
let template: HTMLTemplateElement | undefined

export function decodeHTMLStrict(text: string) {
  return text.replace(references, (reference) => {
    const cached = cache.get(reference)
    if (cached !== undefined) return cached
    template ??= document.createElement('template')
    // The matched reference contains no quotes or markup. Entity results cannot
    // introduce markup because HTML tokenization does not parse them a second time.
    template.innerHTML = `<span data-value="${reference}"></span>`
    const decoded = template.content.firstElementChild?.getAttribute('data-value') ?? reference
    if (cache.size >= 256) cache.clear()
    cache.set(reference, decoded)
    return decoded
  })
}
