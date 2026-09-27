import { AsyncLocalStorage } from 'node:async_hooks'

type PerNovelWriteGateOwnership = {
  active: boolean
}

const perNovelWriteGateTails = new Map<string, Promise<void>>()
const perNovelWriteGateScope = new AsyncLocalStorage<ReadonlyMap<string, PerNovelWriteGateOwnership>>()

export async function runWithPerNovelWriteGate<T>(novelId: string, callback: () => T | Promise<T>) {
  const inheritedOwnership = perNovelWriteGateScope.getStore()
  if (inheritedOwnership?.get(novelId)?.active) {
    return callback()
  }

  const previousTail = perNovelWriteGateTails.get(novelId) ?? Promise.resolve()
  let releaseCurrentTail!: () => void
  const currentTail = new Promise<void>((resolve) => {
    releaseCurrentTail = resolve
  })
  const queuedTail = previousTail.catch(() => undefined).then(() => currentTail)
  perNovelWriteGateTails.set(novelId, queuedTail)

  await previousTail.catch(() => undefined)
  const ownership: PerNovelWriteGateOwnership = { active: true }
  const ownedNovelIds = new Map(inheritedOwnership ?? [])
  ownedNovelIds.set(novelId, ownership)

  try {
    return await perNovelWriteGateScope.run(ownedNovelIds, callback)
  } finally {
    ownership.active = false
    releaseCurrentTail()
    if (perNovelWriteGateTails.get(novelId) === queuedTail) {
      perNovelWriteGateTails.delete(novelId)
    }
  }
}

export function resetPerNovelWriteGatesForTests() {
  perNovelWriteGateTails.clear()
}
