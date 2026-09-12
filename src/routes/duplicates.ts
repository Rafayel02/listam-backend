import { Router } from 'express'
import { pool } from '../db.js'
import {
  getDuplicateJobState,
  startDuplicateDetection,
} from '../services/duplicateDetection.js'

export const duplicatesRouter = Router()

function rowToListingSummary(row: Record<string, unknown>) {
  return {
    id: row.id,
    url: row.url,
    title: row.title ?? undefined,
    ownerId: row.owner_id ?? undefined,
    thumbnailUrl: row.thumbnail_url ?? undefined,
    price: row.price != null ? Number(row.price) : undefined,
    currency: row.currency ?? undefined,
    district: row.district ?? undefined,
  }
}

duplicatesRouter.get('/duplicates/status', (_req, res) => {
  res.json(getDuplicateJobState())
})

duplicatesRouter.post('/duplicates/detect', (_req, res) => {
  const result = startDuplicateDetection()
  if (!result.started) {
    res.status(409).json({
      error: 'Duplicate detection is already running',
      ...getDuplicateJobState(),
    })
    return
  }
  res.status(202).json(result.state)
})

duplicatesRouter.get('/duplicates', async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT p.*,
            la.id AS a_id, la.url AS a_url, la.title AS a_title, la.owner_id AS a_owner_id,
            la.thumbnail_url AS a_thumbnail_url, la.price AS a_price, la.currency AS a_currency,
            la.district AS a_district,
            lb.id AS b_id, lb.url AS b_url, lb.title AS b_title, lb.owner_id AS b_owner_id,
            lb.thumbnail_url AS b_thumbnail_url, lb.price AS b_price, lb.currency AS b_currency,
            lb.district AS b_district
     FROM listing_duplicate_pairs p
     JOIN listings la ON la.id = p.listing_id_a
     JOIN listings lb ON lb.id = p.listing_id_b
     ORDER BY p.avg_similarity DESC, p.match_ratio DESC`,
  )

  const pairs = rows.map((r) => ({
    id: r.id,
    matchRatio: Number(r.match_ratio),
    avgSimilarity: Number(r.avg_similarity),
    comparedAt: Number(r.compared_at),
    listingA: rowToListingSummary({
      id: r.a_id,
      url: r.a_url,
      title: r.a_title,
      owner_id: r.a_owner_id,
      thumbnail_url: r.a_thumbnail_url,
      price: r.a_price,
      currency: r.a_currency,
      district: r.a_district,
    }),
    listingB: rowToListingSummary({
      id: r.b_id,
      url: r.b_url,
      title: r.b_title,
      owner_id: r.b_owner_id,
      thumbnail_url: r.b_thumbnail_url,
      price: r.b_price,
      currency: r.b_currency,
      district: r.b_district,
    }),
  }))

  const byListingId: Record<string, string[]> = {}
  for (const pair of pairs) {
    const a = pair.listingA.id as string
    const b = pair.listingB.id as string
    if (!byListingId[a]) byListingId[a] = []
    if (!byListingId[b]) byListingId[b] = []
    byListingId[a].push(b)
    byListingId[b].push(a)
  }

  res.json({
    pairs,
    byListingId,
    job: getDuplicateJobState(),
  })
})
