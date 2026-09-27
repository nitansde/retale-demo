// On-disk format: vectorDimension consecutive IEEE-754 float32 values, little-endian.
export function encodeEmbeddingVector(vector: readonly number[]) {
  if (!vector.length) throw new Error('Embedding vector must be non-empty')
  const bytes = new Uint8Array(vector.length * 4)
  const view = new DataView(bytes.buffer)
  for (let index = 0; index < vector.length; index++) {
    const value = vector[index]
    if (!Number.isFinite(value) || !Number.isFinite(Math.fround(value))) {
      throw new Error(`Embedding vector value at index ${index} cannot be represented as finite float32`)
    }
    view.setFloat32(index * 4, value, true)
  }
  return bytes
}

export function decodeEmbeddingVector(bytes: Uint8Array, dimension: number) {
  if (!Number.isSafeInteger(dimension) || dimension <= 0 || bytes.byteLength !== dimension * 4) {
    throw new Error('Stored embedding vector byte length does not match its dimension')
  }
  // DataView supports SQLite buffers with arbitrary, including unaligned, offsets.
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  return Array.from({ length: dimension }, (_, index) => {
    const value = view.getFloat32(index * 4, true)
    if (!Number.isFinite(value)) throw new Error('Stored embedding vector contains a non-finite value')
    return value
  })
}
