import os from 'node:os'
import { pool } from '../db.js'
import { parseJsonArray } from '../utils/json.js'
import { hashSimilarity, computePHash } from './phash.js'
import { mapPool } from './pool.js'

const IMAGE_MATCH_THRESHOLD = 0.9
const LISTING_MATCH_RATIO = 0.8
const FETCH_CONCURRENCY = Math.max(4, os.cpus().length * 2)
const PAIR_CONCURRENCY = Math.max(4, os.cpus().length)

export type DuplicateJobStatus = 'idle' | 'running' | 'completed' | 'failed'

export interface DuplicateJobProgress {
  phase: 'hashing' | 'comparing' | 'saving'
  current: number
  total: number
  message: string
}

export interface DuplicateJobState {
  status: DuplicateJobStatus
  startedAt?: number
  finishedAt?: number
  progress?: DuplicateJobProgress
  error?: string
  pairsFound?: number
  listingsCompared?: number
  listingsEligible?: number
}

interface ListingRow {
  id: string
  ownerId: string | null
  imageUrls: string[]
}

interface PairCandidate {
  a: ListingRow
  b: ListingRow
}

const jobState: DuplicateJobState = { status: 'idle' }

export function getDuplicateJobState(): DuplicateJobState {
  return { ...jobState, progress: jobState.progress ? { ...jobState.progress } : undefined }
}

export function startDuplicateDetection(): { started: boolean; state: DuplicateJobState } {
  if (jobState.status === 'running') {
    return { started: false, state: getDuplicateJobState() }
  }

  jobState.status = 'running'
  jobState.startedAt = Date.now()
  jobState.finishedAt = undefined
  jobState.error = undefined
  jobState.pairsFound = undefined
  jobState.listingsCompared = undefined
  jobState.listingsEligible = undefined
  jobState.progress = {
    phase: 'hashing',
    current: 0,
    total: 0,
    message: 'Starting…',
  }

  void runDuplicateDetection().catch((err) => {
    jobState.status = 'failed'
    jobState.finishedAt = Date.now()
    jobState.error = (err as Error).message
    console.error('Duplicate detection failed:', err)
  })

  return { started: true, state: getDuplicateJobState() }
}

async function fetchImageBuffer(url: string): Promise<Buffer | null> {
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; listam-backend/1.0)',
        Referer: 'https://www.list.am/',
      },
      signal: AbortSignal.timeout(20_000),
    })
    if (!res.ok) return null
    const buf = Buffer.from(await res.arrayBuffer())
    return buf.length > 0 ? buf : null
  } catch {
    return null
  }
}

function compareListingHashes(
  hashesA: string[],
  hashesB: string[],
): { match: boolean; matchRatio: number; avgSimilarity: number } {
  if (hashesA.length === 0 || hashesB.length === 0) {
    return { match: false, matchRatio: 0, avgSimilarity: 0 }
  }

  const smaller = hashesA.length <= hashesB.length ? hashesA : hashesB
  const larger = hashesA.length <= hashesB.length ? hashesB : hashesA

  let matched = 0
  let simSum = 0

  for (const hash of smaller) {
    let best = 0
    for (const other of larger) {
      const sim = hashSimilarity(hash, other)
      if (sim > best) best = sim
    }
    if (best >= IMAGE_MATCH_THRESHOLD) {
      matched++
      simSum += best
    }
  }

  const matchRatio = matched / smaller.length
  const avgSimilarity = matched > 0 ? simSum / matched : 0

  return {
    match: matchRatio >= LISTING_MATCH_RATIO,
    matchRatio: Math.round(matchRatio * 1000) / 1000,
    avgSimilarity: Math.round(avgSimilarity * 1000) / 1000,
  }
}

function canonicalPairId(a: string, b: string): { id: string; listingIdA: string; listingIdB: string } {
  if (a < b) return { id: `${a}__${b}`, listingIdA: a, listingIdB: b }
  return { id: `${b}__${a}`, listingIdA: b, listingIdB: a }
}

async function loadListings(): Promise<ListingRow[]> {
  const { rows } = await pool.query<{ id: string; owner_id: string | null; image_urls: unknown }>(
    `SELECT id, owner_id, image_urls FROM listings
     WHERE enrichment_status = 'complete'
       AND COALESCE(is_removed, false) = false
       AND image_urls IS NOT NULL`,
  )

  return rows
    .map((row) => ({
      id: row.id,
      ownerId: row.owner_id,
      imageUrls: parseJsonArray(row.image_urls),
    }))
    .filter((row) => row.imageUrls.length > 0)
}

async function hashListingImages(
  listings: ListingRow[],
  onProgress: (current: number, total: number) => void,
): Promise<Map<string, string[]>> {
  const uniqueUrls = [...new Set(listings.flatMap((l) => l.imageUrls))]
  const urlToHash = new Map<string, string | null>()
  let done = 0

  await mapPool(uniqueUrls, FETCH_CONCURRENCY, async (url) => {
    const buffer = await fetchImageBuffer(url)
    let hash: string | null = null
    if (buffer) {
      try {
        hash = await computePHash(buffer)
      } catch {
        hash = null
      }
    }
    urlToHash.set(url, hash)
    done++
    onProgress(done, uniqueUrls.length)
  })

  const listingHashes = new Map<string, string[]>()
  const hashRows: { listingId: string; imageUrl: string; phash: string }[] = []

  for (const listing of listings) {
    const hashes: string[] = []
    for (const url of listing.imageUrls) {
      const hash = urlToHash.get(url)
      if (hash) {
        hashes.push(hash)
        hashRows.push({ listingId: listing.id, imageUrl: url, phash: hash })
      }
    }
    if (hashes.length > 0) listingHashes.set(listing.id, hashes)
  }

  await pool.query('DELETE FROM listing_image_hashes')
  if (hashRows.length > 0) {
    const values: unknown[] = []
    const placeholders = hashRows
      .map((row, i) => {
        const base = i * 3
        values.push(row.listingId, row.imageUrl, row.phash)
        return `($${base + 1}, $${base + 2}, $${base + 3})`
      })
      .join(', ')
    await pool.query(
      `INSERT INTO listing_image_hashes (listing_id, image_url, phash) VALUES ${placeholders}`,
      values,
    )
  }

  return listingHashes
}

function buildPairCandidates(listings: ListingRow[]): PairCandidate[] {
  const pairs: PairCandidate[] = []
  for (let i = 0; i < listings.length; i++) {
    for (let j = i + 1; j < listings.length; j++) {
      const a = listings[i]
      const b = listings[j]
      if (!a.ownerId || !b.ownerId) continue
      if (a.ownerId === b.ownerId) continue
      pairs.push({ a, b })
    }
  }
  return pairs
}

async function runDuplicateDetection(): Promise<void> {
  const listings = await loadListings()
  jobState.listingsEligible = listings.length

  if (listings.length < 2) {
    await pool.query('DELETE FROM listing_duplicate_pairs')
    jobState.status = 'completed'
    jobState.finishedAt = Date.now()
    jobState.pairsFound = 0
    jobState.listingsCompared = listings.length
    jobState.progress = {
      phase: 'saving',
      current: 1,
      total: 1,
      message:
        listings.length === 0
          ? 'No detail-analyzed listings with images found'
          : 'Need at least 2 listings with images to compare',
    }
    return
  }

  jobState.progress = {
    phase: 'hashing',
    current: 0,
    total: 0,
    message: `Hashing images for ${listings.length} listings…`,
  }

  const listingHashes = await hashListingImages(listings, (current, total) => {
    jobState.progress = {
      phase: 'hashing',
      current,
      total,
      message: `Hashing images (${current}/${total})…`,
    }
  })

  const eligible = listings.filter((l) => listingHashes.has(l.id))
  const pairs = buildPairCandidates(eligible)

  jobState.progress = {
    phase: 'comparing',
    current: 0,
    total: pairs.length,
    message: `Comparing ${pairs.length} listing pairs…`,
  }

  const matches: {
    listingIdA: string
    listingIdB: string
    matchRatio: number
    avgSimilarity: number
  }[] = []

  let compared = 0
  await mapPool(pairs, PAIR_CONCURRENCY, async ({ a, b }) => {
    const hashesA = listingHashes.get(a.id) ?? []
    const hashesB = listingHashes.get(b.id) ?? []
    const result = compareListingHashes(hashesA, hashesB)
    compared++
    if (compared % 50 === 0 || compared === pairs.length) {
      jobState.progress = {
        phase: 'comparing',
        current: compared,
        total: pairs.length,
        message: `Comparing pairs (${compared}/${pairs.length})…`,
      }
    }
    if (result.match) {
      const { listingIdA, listingIdB } = canonicalPairId(a.id, b.id)
      matches.push({
        listingIdA,
        listingIdB,
        matchRatio: result.matchRatio,
        avgSimilarity: result.avgSimilarity,
      })
    }
  })

  jobState.progress = {
    phase: 'saving',
    current: 0,
    total: 1,
    message: 'Saving results…',
  }

  await pool.query('DELETE FROM listing_duplicate_pairs')
  const now = Date.now()

  if (matches.length > 0) {
    const values: unknown[] = []
    const placeholders = matches
      .map((m, i) => {
        const base = i * 6
        const { id } = canonicalPairId(m.listingIdA, m.listingIdB)
        values.push(id, m.listingIdA, m.listingIdB, m.matchRatio, m.avgSimilarity, now)
        return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6})`
      })
      .join(', ')

    await pool.query(
      `INSERT INTO listing_duplicate_pairs
        (id, listing_id_a, listing_id_b, match_ratio, avg_similarity, compared_at)
       VALUES ${placeholders}`,
      values,
    )
  }

  jobState.status = 'completed'
  jobState.finishedAt = Date.now()
  jobState.pairsFound = matches.length
  jobState.listingsCompared = eligible.length
  jobState.progress = {
    phase: 'saving',
    current: 1,
    total: 1,
    message: `Done — ${matches.length} duplicate pair${matches.length === 1 ? '' : 's'} found`,
  }
}
