import imghash from 'imghash'

const HASH_BITS = 64

function hammingDistance(hexA: string, hexB: string): number {
  const binA = imghash.hexToBinary(hexA)
  const binB = imghash.hexToBinary(hexB)
  const len = Math.min(binA.length, binB.length)
  let distance = 0
  for (let i = 0; i < len; i++) {
    if (binA[i] !== binB[i]) distance++
  }
  return distance + Math.abs(binA.length - binB.length)
}

/** 1 = identical, 0 = completely different */
export function hashSimilarity(hexA: string, hexB: string): number {
  const distance = hammingDistance(hexA, hexB)
  const score = 1 - distance / HASH_BITS
  return Math.max(0, Math.min(1, Math.round(score * 1000) / 1000))
}

export async function computePHash(buffer: Buffer): Promise<string> {
  return imghash.hash(buffer)
}
