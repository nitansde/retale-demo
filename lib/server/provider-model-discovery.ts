export const PROVIDER_MODEL_DISCOVERY_TIMEOUT_MS = 10_000

export async function withProviderModelDiscoveryDeadline<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  inputSignal?: AbortSignal,
): Promise<T> {
  const controller = new AbortController()
  let timeout: ReturnType<typeof setTimeout> | null = null
  const abortFromInputSignal = () => controller.abort(inputSignal?.reason)

  try {
    if (inputSignal?.aborted) {
      controller.abort(inputSignal.reason)
    } else {
      inputSignal?.addEventListener('abort', abortFromInputSignal, { once: true })
    }

    timeout = setTimeout(() => {
      controller.abort(new DOMException(
        `Provider model discovery timed out after ${PROVIDER_MODEL_DISCOVERY_TIMEOUT_MS}ms`,
        'TimeoutError',
      ))
    }, PROVIDER_MODEL_DISCOVERY_TIMEOUT_MS)

    controller.signal.throwIfAborted()
    return await operation(controller.signal)
  } finally {
    if (timeout !== null) {
      clearTimeout(timeout)
    }
    inputSignal?.removeEventListener('abort', abortFromInputSignal)
  }
}
