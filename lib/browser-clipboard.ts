export async function writeTextToClipboard(text: string) {
  const clipboard = globalThis.navigator?.clipboard
  if (globalThis.isSecureContext !== false && typeof clipboard?.writeText === 'function') {
    try {
      await clipboard.writeText(text)
      return
    } catch {
      // Fall through to the selection-based copy path used by plain HTTP origins.
    }
  }

  if (typeof document === 'undefined' || typeof document.execCommand !== 'function') {
    throw new Error('Clipboard access is unavailable')
  }

  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.setAttribute('readonly', '')
  textarea.style.position = 'fixed'
  textarea.style.inset = '0 auto auto -9999px'
  textarea.style.opacity = '0'
  document.body.appendChild(textarea)

  const activeElement = document.activeElement instanceof HTMLElement ? document.activeElement : null
  textarea.focus()
  textarea.select()
  textarea.setSelectionRange(0, textarea.value.length)

  try {
    if (!document.execCommand('copy')) {
      throw new Error('Clipboard copy was rejected')
    }
  } finally {
    textarea.remove()
    activeElement?.focus()
  }
}
