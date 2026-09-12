import { Router } from 'express'
import { pool } from '../db.js'

export const readRouter = Router()

function rowToListing(row: Record<string, unknown>) {
  return {
    id: row.id,
    url: row.url,
    ownerId: row.owner_id ?? undefined,
    title: row.title ?? undefined,
    price: row.price ?? undefined,
    currency: row.currency ?? undefined,
    isMonthly: row.is_monthly ?? undefined,
    thumbnailUrl: row.thumbnail_url ?? undefined,
    street: row.street ?? undefined,
    district: row.district ?? undefined,
    rooms: row.rooms ?? undefined,
    areaSqm: row.area_sqm ?? undefined,
    currentFloor: row.current_floor ?? undefined,
    totalFloors: row.total_floors ?? undefined,
    badges: row.badges ?? undefined,
    verificationStatus: row.verification_status ?? undefined,
    description: row.description ?? undefined,
    imageUrls: row.image_urls ?? undefined,
    attributes: row.attributes ?? undefined,
    sourcePriceHistory: row.source_price_history ?? undefined,
    postedAt: row.posted_at ?? undefined,
    renewedAt: row.renewed_at ?? undefined,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    lastChangedAt: row.last_changed_at,
    enrichmentStatus: row.enrichment_status,
    enrichmentError: row.enrichment_error ?? undefined,
    isRemoved: row.is_removed ?? false,
    removedAt: row.removed_at ?? undefined,
    cardExtras: row.card_extras ?? undefined,
    detailExtras: row.detail_extras ?? undefined,
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
    sitePostsCount: row.site_posts_count ?? undefined,
    scrapedPostsCount: row.scraped_posts_count ?? undefined,
    ownerExtras: row.owner_extras ?? undefined,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    lastChangedAt: row.last_changed_at,
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
