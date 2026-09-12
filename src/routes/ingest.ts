import { Router } from 'express'
import type { IngestPayload } from '../types.js'
import { pool } from '../db.js'
import { requireApiKey } from '../middleware/auth.js'

export const ingestRouter = Router()

ingestRouter.post('/', requireApiKey, async (req, res) => {
  const body = req.body as IngestPayload
  const counts: Record<string, number> = {}
  const client = await pool.connect()

  try {
    await client.query('BEGIN')

    if (body.searches?.length) {
      for (const s of body.searches) {
        await client.query(
          `INSERT INTO searches (id, name, url, created_at, updated_at)
           VALUES ($1,$2,$3,$4,$5)
           ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, url=EXCLUDED.url, updated_at=EXCLUDED.updated_at`,
          [s.id, s.name ?? null, s.url, s.createdAt, s.updatedAt],
        )
      }
      counts.searches = body.searches.length
    }

    if (body.owners?.length) {
      for (const o of body.owners) {
        await client.query(
          `INSERT INTO owners (
            id, profile_url, name, avatar_url, is_verified_company, rating, review_count,
            tenure_text, description, reviews_url, site_posts_count, scraped_posts_count,
            owner_extras, first_seen_at, last_seen_at, last_changed_at
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
          ON CONFLICT (id) DO UPDATE SET
            profile_url=EXCLUDED.profile_url, name=EXCLUDED.name, avatar_url=EXCLUDED.avatar_url,
            is_verified_company=EXCLUDED.is_verified_company, rating=EXCLUDED.rating,
            review_count=EXCLUDED.review_count, tenure_text=EXCLUDED.tenure_text,
            description=EXCLUDED.description, reviews_url=EXCLUDED.reviews_url,
            site_posts_count=EXCLUDED.site_posts_count, scraped_posts_count=EXCLUDED.scraped_posts_count,
            owner_extras=EXCLUDED.owner_extras, last_seen_at=EXCLUDED.last_seen_at,
            last_changed_at=EXCLUDED.last_changed_at`,
          [
            o.id,
            o.profileUrl,
            o.name ?? null,
            o.avatarUrl ?? null,
            o.isVerifiedCompany ?? null,
            o.rating ?? null,
            o.reviewCount ?? null,
            o.tenureText ?? null,
            o.description ?? null,
            o.reviewsUrl ?? null,
            o.sitePostsCount ?? null,
            o.scrapedPostsCount ?? null,
            o.ownerExtras ? JSON.stringify(o.ownerExtras) : null,
            o.firstSeenAt,
            o.lastSeenAt,
            o.lastChangedAt,
          ],
        )
      }
      counts.owners = body.owners.length
    }

    if (body.listings?.length) {
      for (const l of body.listings) {
        await client.query(
          `INSERT INTO listings (
            id, url, owner_id, title, price, currency, is_monthly, thumbnail_url, street, district,
            rooms, area_sqm, current_floor, total_floors, badges, verification_status, description,
            image_urls, attributes, source_price_history, posted_at, renewed_at,
            first_seen_at, last_seen_at, last_changed_at, enrichment_status, enrichment_error,
            is_removed, removed_at, card_extras, detail_extras
          ) VALUES (
            $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31
          )
          ON CONFLICT (id) DO UPDATE SET
            url=EXCLUDED.url, owner_id=EXCLUDED.owner_id, title=EXCLUDED.title, price=EXCLUDED.price,
            currency=EXCLUDED.currency, is_monthly=EXCLUDED.is_monthly, thumbnail_url=EXCLUDED.thumbnail_url,
            street=EXCLUDED.street, district=EXCLUDED.district, rooms=EXCLUDED.rooms, area_sqm=EXCLUDED.area_sqm,
            current_floor=EXCLUDED.current_floor, total_floors=EXCLUDED.total_floors, badges=EXCLUDED.badges,
            verification_status=EXCLUDED.verification_status, description=EXCLUDED.description,
            image_urls=EXCLUDED.image_urls, attributes=EXCLUDED.attributes,
            source_price_history=EXCLUDED.source_price_history, posted_at=EXCLUDED.posted_at,
            renewed_at=EXCLUDED.renewed_at, last_seen_at=EXCLUDED.last_seen_at,
            last_changed_at=EXCLUDED.last_changed_at, enrichment_status=EXCLUDED.enrichment_status,
            enrichment_error=EXCLUDED.enrichment_error, is_removed=EXCLUDED.is_removed,
            removed_at=EXCLUDED.removed_at, card_extras=EXCLUDED.card_extras, detail_extras=EXCLUDED.detail_extras`,
          [
            l.id,
            l.url,
            l.ownerId ?? null,
            l.title ?? null,
            l.price ?? null,
            l.currency ?? null,
            l.isMonthly ?? null,
            l.thumbnailUrl ?? null,
            l.street ?? null,
            l.district ?? null,
            l.rooms ?? null,
            l.areaSqm ?? null,
            l.currentFloor ?? null,
            l.totalFloors ?? null,
            l.badges ? JSON.stringify(l.badges) : null,
            l.verificationStatus ?? null,
            l.description ?? null,
            l.imageUrls ? JSON.stringify(l.imageUrls) : null,
            l.attributes ? JSON.stringify(l.attributes) : null,
            l.sourcePriceHistory ? JSON.stringify(l.sourcePriceHistory) : null,
            l.postedAt ?? null,
            l.renewedAt ?? null,
            l.firstSeenAt,
            l.lastSeenAt,
            l.lastChangedAt,
            l.enrichmentStatus,
            l.enrichmentError ?? null,
            l.isRemoved ?? false,
            l.removedAt ?? null,
            l.cardExtras ? JSON.stringify(l.cardExtras) : null,
            l.detailExtras ? JSON.stringify(l.detailExtras) : null,
          ],
        )
      }
      counts.listings = body.listings.length
    }

    if (body.searchListings?.length) {
      for (const sl of body.searchListings) {
        await client.query(
          `INSERT INTO search_listings (id, search_id, listing_id, first_seen_at, last_seen_at, is_present)
           VALUES ($1,$2,$3,$4,$5,$6)
           ON CONFLICT (id) DO UPDATE SET last_seen_at=EXCLUDED.last_seen_at, is_present=EXCLUDED.is_present`,
          [sl.id, sl.searchId, sl.listingId, sl.firstSeenAt, sl.lastSeenAt, sl.isPresent],
        )
      }
      counts.searchListings = body.searchListings.length
    }

    if (body.scrapeRuns?.length) {
      for (const r of body.scrapeRuns) {
        await client.query(
          `INSERT INTO scrape_runs (
            id, search_id, status, started_at, finished_at, last_completed_page, current_page,
            search_pages_complete, pending_detail_ids, processing_detail_ids, completed_detail_ids,
            failed_detail_ids, discovered_listing_ids, detail_retry_counts, awaiting_user_ready, refresh_details
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
          ON CONFLICT (id) DO UPDATE SET
            status=EXCLUDED.status, finished_at=EXCLUDED.finished_at,
            last_completed_page=EXCLUDED.last_completed_page, current_page=EXCLUDED.current_page,
            search_pages_complete=EXCLUDED.search_pages_complete,
            pending_detail_ids=EXCLUDED.pending_detail_ids,
            processing_detail_ids=EXCLUDED.processing_detail_ids,
            completed_detail_ids=EXCLUDED.completed_detail_ids,
            failed_detail_ids=EXCLUDED.failed_detail_ids,
            discovered_listing_ids=EXCLUDED.discovered_listing_ids,
            detail_retry_counts=EXCLUDED.detail_retry_counts,
            awaiting_user_ready=EXCLUDED.awaiting_user_ready,
            refresh_details=EXCLUDED.refresh_details`,
          [
            r.id,
            r.searchId,
            r.status,
            r.startedAt,
            r.finishedAt ?? null,
            r.lastCompletedPage,
            r.currentPage,
            r.searchPagesComplete,
            JSON.stringify(r.pendingDetailIds),
            JSON.stringify(r.processingDetailIds),
            JSON.stringify(r.completedDetailIds),
            JSON.stringify(r.failedDetailIds),
            JSON.stringify(r.discoveredListingIds),
            JSON.stringify(r.detailRetryCounts),
            r.awaitingUserReady,
            r.refreshDetails ?? null,
          ],
        )
      }
      counts.scrapeRuns = body.scrapeRuns.length
    }

    if (body.runListingStatuses?.length) {
      for (const rs of body.runListingStatuses) {
        await client.query(
          `INSERT INTO run_listing_statuses (id, run_id, listing_id, status, existed_before_run)
           VALUES ($1,$2,$3,$4,$5)
           ON CONFLICT (id) DO UPDATE SET status=EXCLUDED.status`,
          [rs.id, rs.runId, rs.listingId, rs.status, rs.existedBeforeRun],
        )
      }
      counts.runListingStatuses = body.runListingStatuses.length
    }

    if (body.scrapeLogs?.length) {
      for (const log of body.scrapeLogs) {
        await client.query(
          `INSERT INTO scrape_logs (run_id, timestamp, level, message) VALUES ($1,$2,$3,$4)`,
          [log.runId, log.timestamp, log.level, log.message],
        )
      }
      counts.scrapeLogs = body.scrapeLogs.length
    }

    if (body.listingChanges?.length) {
      for (const change of body.listingChanges) {
        await client.query(
          `INSERT INTO listing_changes (listing_id, scrape_run_id, changed_at, changes)
           VALUES ($1,$2,$3,$4)`,
          [
            change.listingId,
            change.scrapeRunId,
            change.changedAt,
            JSON.stringify(change.changes),
          ],
        )
      }
      counts.listingChanges = body.listingChanges.length
    }

    await client.query('COMMIT')
    res.json({ ok: true, counts })
  } catch (err) {
    await client.query('ROLLBACK')
    console.error(err)
    res.status(500).json({ error: (err as Error).message })
  } finally {
    client.release()
  }
})
