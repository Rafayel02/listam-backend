import { Router } from 'express'
import { pool } from '../db.js'
import {
  getDayEventsPage,
  getDayOwnerSummaries,
  getDaySummaries,
  getOwnerDayEventsPage,
  HISTORY_PAGE_SIZE,
} from '../services/dailyHistory.js'

export const readRouter = Router()

function asNumber(value: unknown): number | undefined {
  if (value == null || value === '') return undefined
  const n = Number(value)
  return Number.isFinite(n) ? n : undefined
}

function asJson<T>(value: unknown): T | undefined {
  if (value == null) return undefined
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as T
    } catch {
      return undefined
    }
  }
  return value as T
}

function rowToListing(row: Record<string, unknown>) {
  return {
    id: row.id,
    url: row.url,
    ownerId: row.owner_id ?? undefined,
    title: row.title ?? undefined,
    price: asNumber(row.price),
    currency: row.currency ?? undefined,
    isMonthly: row.is_monthly ?? undefined,
    thumbnailUrl: row.thumbnail_url ?? undefined,
    street: row.street ?? undefined,
    district: row.district ?? undefined,
    rooms: asNumber(row.rooms),
    areaSqm: asNumber(row.area_sqm),
    currentFloor: asNumber(row.current_floor),
    totalFloors: asNumber(row.total_floors),
    badges: asJson(row.badges),
    verificationStatus: row.verification_status ?? undefined,
    description: row.description ?? undefined,
    imageUrls: asJson<string[]>(row.image_urls),
    attributes: asJson<Record<string, string>>(row.attributes),
    sourcePriceHistory: asJson(row.source_price_history),
    postedAt: asNumber(row.posted_at),
    renewedAt: asNumber(row.renewed_at),
    firstSeenAt: asNumber(row.first_seen_at) ?? 0,
    lastSeenAt: asNumber(row.last_seen_at) ?? 0,
    lastChangedAt: asNumber(row.last_changed_at) ?? 0,
    enrichmentStatus: row.enrichment_status,
    enrichmentError: row.enrichment_error ?? undefined,
    isRemoved: row.is_removed ?? false,
    removedAt: asNumber(row.removed_at),
    cardExtras: asJson(row.card_extras),
    detailExtras: asJson(row.detail_extras),
  }
}

function rowToOwner(row: Record<string, unknown>) {
  return {
    id: row.id,
    profileUrl: row.profile_url,
    name: row.name ?? undefined,
    avatarUrl: row.avatar_url ?? undefined,
    isVerifiedCompany: row.is_verified_company ?? undefined,
    rating: row.rating ?? undefined,
    reviewCount: row.review_count ?? undefined,
    tenureText: row.tenure_text ?? undefined,
    description: row.description ?? undefined,
    reviewsUrl: row.reviews_url ?? undefined,
    sitePostsCount: asNumber(row.site_posts_count),
    scrapedPostsCount: asNumber(row.scraped_posts_count),
    ownerExtras: asJson(row.owner_extras),
    firstSeenAt: asNumber(row.first_seen_at) ?? 0,
    lastSeenAt: asNumber(row.last_seen_at) ?? 0,
    lastChangedAt: asNumber(row.last_changed_at) ?? 0,
  }
}

readRouter.get('/searches', async (_req, res) => {
  const { rows } = await pool.query('SELECT * FROM searches ORDER BY created_at DESC')
  res.json(
    rows.map((r) => ({
      id: r.id,
      name: r.name ?? undefined,
      url: r.url,
      createdAt: Number(r.created_at),
      updatedAt: Number(r.updated_at),
    })),
  )
})

readRouter.get('/listings', async (req, res) => {
  const searchId = req.query.searchId as string | undefined
  const limit = Math.min(Number(req.query.limit ?? 5000), 10000)

  let rows
  if (searchId) {
    const result = await pool.query(
      `SELECT l.* FROM listings l
       JOIN search_listings sl ON sl.listing_id = l.id
       WHERE sl.search_id = $1
       ORDER BY l.last_seen_at DESC
       LIMIT $2`,
      [searchId, limit],
    )
    rows = result.rows
  } else {
    const result = await pool.query(
      'SELECT * FROM listings ORDER BY last_seen_at DESC LIMIT $1',
      [limit],
    )
    rows = result.rows
  }

  res.json(rows.map(rowToListing))
})

readRouter.get('/owners', async (_req, res) => {
  const { rows } = await pool.query('SELECT * FROM owners ORDER BY last_seen_at DESC')
  res.json(rows.map(rowToOwner))
})

readRouter.get('/scrape-runs', async (req, res) => {
  const searchId = req.query.searchId as string | undefined
  const { rows } = searchId
    ? await pool.query(
        'SELECT * FROM scrape_runs WHERE search_id = $1 ORDER BY started_at DESC',
        [searchId],
      )
    : await pool.query('SELECT * FROM scrape_runs ORDER BY started_at DESC LIMIT 100')

  res.json(
    rows.map((r) => ({
      id: r.id,
      searchId: r.search_id,
      status: r.status,
      startedAt: Number(r.started_at),
      finishedAt: r.finished_at ? Number(r.finished_at) : undefined,
      lastCompletedPage: r.last_completed_page,
      currentPage: r.current_page,
      searchPagesComplete: r.search_pages_complete,
      pendingDetailIds: r.pending_detail_ids,
      processingDetailIds: r.processing_detail_ids,
      completedDetailIds: r.completed_detail_ids,
      failedDetailIds: r.failed_detail_ids,
      discoveredListingIds: r.discovered_listing_ids,
      detailRetryCounts: r.detail_retry_counts,
      awaitingUserReady: r.awaiting_user_ready,
      refreshDetails: r.refresh_details ?? undefined,
    })),
  )
})

readRouter.get('/search-listings', async (req, res) => {
  const searchId = req.query.searchId as string | undefined
  const { rows } = searchId
    ? await pool.query(
        'SELECT * FROM search_listings WHERE search_id = $1 ORDER BY last_seen_at DESC',
        [searchId],
      )
    : await pool.query('SELECT * FROM search_listings ORDER BY last_seen_at DESC LIMIT 50000')

  res.json(
    rows.map((r) => ({
      id: r.id,
      searchId: r.search_id,
      listingId: r.listing_id,
      firstSeenAt: Number(r.first_seen_at),
      lastSeenAt: Number(r.last_seen_at),
      isPresent: r.is_present,
    })),
  )
})

readRouter.get('/changes/history', async (req, res) => {
  const date = req.query.date as string | undefined
  const view = req.query.view as string | undefined
  const ownerId = req.query.ownerId as string | undefined

  if (date && view === 'owners') {
    const result = await getDayOwnerSummaries(date)
    res.json(result)
    return
  }

  if (date && ownerId) {
    const page = Math.max(Number(req.query.page ?? 1), 1)
    const limit = Math.min(Math.max(Number(req.query.limit ?? HISTORY_PAGE_SIZE), 1), 200)
    const result = await getOwnerDayEventsPage(date, ownerId, page, limit)
    res.json(result)
    return
  }

  if (date) {
    const page = Math.max(Number(req.query.page ?? 1), 1)
    const limit = Math.min(Math.max(Number(req.query.limit ?? HISTORY_PAGE_SIZE), 1), 200)
    const result = await getDayEventsPage(date, page, limit)
    res.json(result)
    return
  }

  const days = Math.min(Math.max(Number(req.query.days ?? 14), 1), 90)
  const summary = await getDaySummaries(days)
  res.json(summary)
})

readRouter.get('/stats/overview', async (_req, res) => {
  const [searches, listings, owners, runs] = await Promise.all([
    pool.query('SELECT COUNT(*)::int AS c FROM searches'),
    pool.query('SELECT COUNT(*)::int AS c FROM listings'),
    pool.query('SELECT COUNT(*)::int AS c FROM owners'),
    pool.query(
      `SELECT COUNT(*)::int AS c FROM scrape_runs WHERE status = 'completed'`,
    ),
  ])

  res.json({
    searches: searches.rows[0].c,
    listings: listings.rows[0].c,
    owners: owners.rows[0].c,
    completedRuns: runs.rows[0].c,
  })
})
