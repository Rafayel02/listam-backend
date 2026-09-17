import { pool } from '../db.js'
import { summarizeFieldChange, type FieldChange } from '../utils/changeFormat.js'
import {
  compareOwnerReputation,
  computeOwnerReputation,
  type OwnerReputation,
} from '../utils/ownerReliability.js'

export type HistoryEventKind = 'added' | 'removed' | 'updated'

export type OwnerActionCategory =
  | 'added'
  | 'removed'
  | 'price'
  | 'images'
  | 'title'
  | 'description'
  | 'location'
  | 'other'

export interface OwnerActionCounts {
  added: number
  removed: number
  price: number
  images: number
  title: number
  description: number
  location: number
  other: number
  total: number
}

export interface HistoryEvent {
  id: string
  kind: HistoryEventKind
  listingId: string
  title?: string
  url: string
  summary: string
  action: OwnerActionCategory
  ownerId?: string
  ownerName?: string
  ownerProfileUrl?: string
  changedAt: number
  date: string
}

export interface OwnerDaySummary {
  ownerId: string
  ownerName?: string
  ownerProfileUrl?: string
  reputation: OwnerReputation
  counts: OwnerActionCounts
}

export interface DayOwnersPage {
  date: string
  label: string
  owners: OwnerDaySummary[]
  totalOwners: number
  totalActions: number
  actionOffset: number
  actionLimit: number
  nextActionOffset: number
  hasMore: boolean
  loadedActionCount: number
}

export interface OwnerDayEventsPage {
  date: string
  label: string
  ownerId: string
  ownerName?: string
  ownerProfileUrl?: string
  events: HistoryEvent[]
  page: number
  limit: number
  total: number
  totalPages: number
}

export const UNKNOWN_OWNER_ID = '_unknown'

export interface ReputationTierBreakdown {
  tier: string
  label: string
  minScore: number | null
  maxScore: number | null
  ownerCount: number
  counts: OwnerActionCounts
}

export interface DayActivitySummary {
  totals: OwnerActionCounts
  byReputation: ReputationTierBreakdown[]
  ownerCount: number
}

export interface DayActivitySummaryPage {
  date: string
  label: string
  summary: DayActivitySummary
}

export interface DaySummary {
  date: string
  label: string
  totalEvents: number
}

const REPUTATION_TIER_DEFINITIONS = [
  { tier: 'high', label: 'High (80+)', minScore: 80, maxScore: 100 },
  { tier: 'good', label: 'Good (60–79)', minScore: 60, maxScore: 79 },
  { tier: 'moderate', label: 'Moderate (40–59)', minScore: 40, maxScore: 59 },
  { tier: 'low', label: 'Low (<40)', minScore: 0, maxScore: 39 },
  { tier: 'unknown', label: 'Unknown owner', minScore: null, maxScore: null },
] as const

export interface DayEventsPage {
  date: string
  label: string
  events: HistoryEvent[]
  page: number
  limit: number
  total: number
  totalPages: number
}

export const HISTORY_PAGE_SIZE = 200

function dayKey(ms: number): string {
  const d = new Date(ms)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function dayLabel(dateKey: string): string {
  const [y, m, d] = dateKey.split('-')
  return `${d}.${m}.${y}`
}

function dayBounds(dateKey: string): { start: number; end: number } {
  const [y, m, d] = dateKey.split('-').map(Number)
  const start = new Date(y, m - 1, d, 0, 0, 0, 0).getTime()
  const end = new Date(y, m - 1, d, 23, 59, 59, 999).getTime()
  return { start, end }
}

function eventId(parts: string[]): string {
  return parts.join(':')
}

function emptyOwnerCounts(): OwnerActionCounts {
  return {
    added: 0,
    removed: 0,
    price: 0,
    images: 0,
    title: 0,
    description: 0,
    location: 0,
    other: 0,
    total: 0,
  }
}

function incrementActionCount(counts: OwnerActionCounts, action: OwnerActionCategory): void {
  counts[action] += 1
  counts.total += 1
}

function reputationTierForEvent(
  ownerId?: string,
  reputation?: OwnerReputation,
): (typeof REPUTATION_TIER_DEFINITIONS)[number]['tier'] {
  if (!ownerId || ownerId === UNKNOWN_OWNER_ID) return 'unknown'
  const score = reputation?.score ?? 0
  if (score >= 80) return 'high'
  if (score >= 60) return 'good'
  if (score >= 40) return 'moderate'
  return 'low'
}

async function buildDayActivitySummary(events: HistoryEvent[]): Promise<DayActivitySummary> {
  const ownerIds = [...new Set(events.map((event) => ownerKey(event.ownerId)))]
  const reputationById = await fetchOwnerReputationMap(ownerIds)
  const totals = emptyOwnerCounts()
  const tierCounts = new Map<string, OwnerActionCounts>()
  const tierOwners = new Map<string, Set<string>>()

  for (const definition of REPUTATION_TIER_DEFINITIONS) {
    tierCounts.set(definition.tier, emptyOwnerCounts())
    tierOwners.set(definition.tier, new Set())
  }

  for (const event of events) {
    const key = ownerKey(event.ownerId)
    const reputation = reputationById.get(key)
    const tier = reputationTierForEvent(event.ownerId, reputation)
    incrementActionCount(totals, event.action)
    incrementActionCount(tierCounts.get(tier)!, event.action)
    tierOwners.get(tier)!.add(key)
  }

  const ownerCount = new Set(events.map((event) => ownerKey(event.ownerId))).size

  return {
    totals,
    ownerCount,
    byReputation: REPUTATION_TIER_DEFINITIONS.map((definition) => ({
      tier: definition.tier,
      label: definition.label,
      minScore: definition.minScore,
      maxScore: definition.maxScore,
      ownerCount: tierOwners.get(definition.tier)!.size,
      counts: tierCounts.get(definition.tier)!,
    })),
  }
}

export function categorizeEvent(
  event: Pick<HistoryEvent, 'kind' | 'summary'>,
): OwnerActionCategory {
  if (event.kind === 'added') return 'added'
  if (event.kind === 'removed') return 'removed'
  const summary = event.summary.toLowerCase()
  if (summary.includes('price')) return 'price'
  if (summary.includes('images')) return 'images'
  if (summary.includes('title')) return 'title'
  if (summary.includes('description')) return 'description'
  if (summary.includes('district') || summary.includes('street')) return 'location'
  return 'other'
}

function ownerFields(row: {
  owner_id: string | null
  owner_name: string | null
  owner_profile_url: string | null
}) {
  return {
    ownerId: row.owner_id ?? undefined,
    ownerName: row.owner_name ?? undefined,
    ownerProfileUrl: row.owner_profile_url ?? undefined,
  }
}

async function fetchChangeRows(fromMs: number, toMs?: number) {
  const params = toMs != null ? [fromMs, toMs] : [fromMs]
  const bound = toMs != null ? 'AND lc.changed_at <= $2' : ''
  return pool.query<{
    listing_id: string
    changed_at: string
    changes: FieldChange[]
    title: string | null
    url: string
    owner_id: string | null
    owner_name: string | null
    owner_profile_url: string | null
  }>(
    `SELECT DISTINCT ON (lc.listing_id, lc.changed_at, lc.changes::text)
            lc.listing_id, lc.changed_at, lc.changes, l.title, l.url,
            l.owner_id, o.name AS owner_name, o.profile_url AS owner_profile_url
     FROM listing_changes lc
     JOIN listings l ON l.id = lc.listing_id
     LEFT JOIN owners o ON o.id = l.owner_id
     WHERE lc.changed_at >= $1 ${bound}
     ORDER BY lc.listing_id, lc.changed_at, lc.changes::text, lc.id DESC`,
    params,
  )
}

async function fetchAddedRows(fromMs: number, toMs?: number) {
  const params = toMs != null ? [fromMs, toMs] : [fromMs]
  const bound = toMs != null ? 'AND l.first_seen_at <= $2' : ''
  return pool.query<{
    id: string
    title: string | null
    url: string
    first_seen_at: string
    owner_id: string | null
    owner_name: string | null
    owner_profile_url: string | null
  }>(
    `SELECT l.id, l.title, l.url, l.first_seen_at,
            l.owner_id, o.name AS owner_name, o.profile_url AS owner_profile_url
     FROM listings l
     LEFT JOIN owners o ON o.id = l.owner_id
     WHERE l.first_seen_at >= $1 ${bound}`,
    params,
  )
}

async function fetchRemovedRows(fromMs: number, toMs?: number) {
  const params = toMs != null ? [fromMs, toMs] : [fromMs]
  const bound = toMs != null ? 'AND l.removed_at <= $2' : ''
  return pool.query<{
    id: string
    title: string | null
    url: string
    removed_at: string
    owner_id: string | null
    owner_name: string | null
    owner_profile_url: string | null
  }>(
    `SELECT l.id, l.title, l.url, l.removed_at,
            l.owner_id, o.name AS owner_name, o.profile_url AS owner_profile_url
     FROM listings l
     LEFT JOIN owners o ON o.id = l.owner_id
     WHERE l.removed_at IS NOT NULL AND l.removed_at >= $1 ${bound}`,
    params,
  )
}

function buildEventsFromRows(
  changeRows: Awaited<ReturnType<typeof fetchChangeRows>>['rows'],
  addedRows: Awaited<ReturnType<typeof fetchAddedRows>>['rows'],
  removedRows: Awaited<ReturnType<typeof fetchRemovedRows>>['rows'],
): HistoryEvent[] {
  const events: HistoryEvent[] = []
  const removedKeys = new Set<string>()

  for (const row of addedRows) {
    const changedAt = Number(row.first_seen_at)
    const summary = 'added'
    events.push({
      id: eventId(['added', row.id, String(changedAt)]),
      kind: 'added',
      listingId: row.id,
      title: row.title ?? undefined,
      url: row.url,
      summary,
      action: 'added',
      ...ownerFields(row),
      changedAt,
      date: dayKey(changedAt),
    })
  }

  for (const row of removedRows) {
    const changedAt = Number(row.removed_at)
    const date = dayKey(changedAt)
    removedKeys.add(`${row.id}:${date}`)
    events.push({
      id: eventId(['removed', row.id, String(changedAt)]),
      kind: 'removed',
      listingId: row.id,
      title: row.title ?? undefined,
      url: row.url,
      summary: 'removed',
      action: 'removed',
      ...ownerFields(row),
      changedAt,
      date,
    })
  }

  for (const row of changeRows) {
    const changedAt = Number(row.changed_at)
    const date = dayKey(changedAt)
    const changes = Array.isArray(row.changes) ? row.changes : []
    const owners = ownerFields(row)

    for (const change of changes) {
      const summary = summarizeFieldChange(change)
      const isRemoval = summary === 'removed'

      if (isRemoval) {
        const key = `${row.listing_id}:${date}`
        if (removedKeys.has(key)) continue
        removedKeys.add(key)
        events.push({
          id: eventId(['removed', row.listing_id, String(changedAt), change.field]),
          kind: 'removed',
          listingId: row.listing_id,
          title: row.title ?? undefined,
          url: row.url,
          summary: 'removed',
          action: 'removed',
          ...owners,
          changedAt,
          date,
        })
        continue
      }

      const event: HistoryEvent = {
        id: eventId(['updated', row.listing_id, String(changedAt), change.field]),
        kind: 'updated',
        listingId: row.listing_id,
        title: row.title ?? undefined,
        url: row.url,
        summary,
        action: categorizeEvent({ kind: 'updated', summary }),
        ...owners,
        changedAt,
        date,
      }
      events.push(event)
    }
  }

  return events.sort((a, b) => b.changedAt - a.changedAt)
}

async function collectEvents(fromMs: number, toMs?: number): Promise<HistoryEvent[]> {
  const [changeRows, addedRows, removedRows] = await Promise.all([
    fetchChangeRows(fromMs, toMs),
    fetchAddedRows(fromMs, toMs),
    fetchRemovedRows(fromMs, toMs),
  ])
  return buildEventsFromRows(changeRows.rows, addedRows.rows, removedRows.rows)
}

function msToDayKey(column: string): string {
  return `to_char(to_timestamp(${column} / 1000.0), 'YYYY-MM-DD')`
}

function mergeDayCounts(
  parts: { date: string; totalEvents: number }[][],
): { date: string; totalEvents: number }[] {
  const totals = new Map<string, number>()
  for (const part of parts) {
    for (const row of part) {
      totals.set(row.date, (totals.get(row.date) ?? 0) + row.totalEvents)
    }
  }
  return [...totals.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([date, totalEvents]) => ({ date, totalEvents }))
}

async function fetchDaySummaryCounts(
  fromMs: number,
): Promise<{ date: string; totalEvents: number }[]> {
  const [added, removed, changes] = await Promise.all([
    pool.query<{ date: string; total_events: number }>(
      `SELECT ${msToDayKey('l.first_seen_at')} AS date,
              COUNT(*)::int AS total_events
       FROM listings l
       WHERE l.first_seen_at >= $1
       GROUP BY 1`,
      [fromMs],
    ),
    pool.query<{ date: string; total_events: number }>(
      `SELECT ${msToDayKey('l.removed_at')} AS date,
              COUNT(*)::int AS total_events
       FROM listings l
       WHERE l.removed_at IS NOT NULL
         AND l.removed_at >= $1
       GROUP BY 1`,
      [fromMs],
    ),
    pool.query<{ date: string; total_events: number }>(
      `SELECT ${msToDayKey('changed_at')} AS date,
              COUNT(*)::int AS total_events
       FROM listing_changes
       WHERE changed_at >= $1
       GROUP BY 1`,
      [fromMs],
    ),
  ])

  const mapRows = (rows: { date: string; total_events: number }[]) =>
    rows.map((row) => ({
      date: row.date,
      totalEvents: Number(row.total_events),
    }))

  return mergeDayCounts([mapRows(added.rows), mapRows(removed.rows), mapRows(changes.rows)])
}

export async function getDaySummaries(days: number): Promise<{
  days: DaySummary[]
  totalEvents: number
}> {
  const safeDays = Math.min(Math.max(days, 1), 90)
  const fromMs = Date.now() - safeDays * 24 * 60 * 60 * 1000
  const counts = await fetchDaySummaryCounts(fromMs)

  const daysList = counts.map(({ date, totalEvents }) => ({
    date,
    label: dayLabel(date),
    totalEvents,
  }))

  return {
    days: daysList,
    totalEvents: counts.reduce((sum, row) => sum + row.totalEvents, 0),
  }
}

function ownerKey(ownerId?: string): string {
  return ownerId ?? UNKNOWN_OWNER_ID
}

const CHANGE_ACTION_SQL = `
  CASE
    WHEN (elem->>'field' = 'isRemoved' AND elem->>'to' = 'true')
      OR (elem->>'field' = 'enrichmentStatus' AND elem->>'to' = 'removed')
    THEN 'removed'
    WHEN elem->>'field' = 'price'
      OR elem->>'field' LIKE 'sourcePriceHistory%'
    THEN 'price'
    WHEN elem->>'field' LIKE 'imageUrls%'
    THEN 'images'
    WHEN elem->>'field' = 'title'
    THEN 'title'
    WHEN elem->>'field' = 'description'
    THEN 'description'
    WHEN elem->>'field' IN ('district', 'street')
    THEN 'location'
    ELSE 'other'
  END
`

async function fetchDayOwnerActionRows(
  start: number,
  end: number,
): Promise<OwnerDaySummary[]> {
  const { rows } = await pool.query<{
    owner_id: string
    owner_name: string | null
    owner_profile_url: string | null
    added: number
    removed: number
    price: number
    images: number
    title: number
    description: number
    location: number
    other: number
    total: number
  }>(
    `
    WITH bounds AS (
      SELECT $1::bigint AS start_ms, $2::bigint AS end_ms
    ),
    removed_listings AS (
      SELECT l.id AS listing_id
      FROM listings l
      CROSS JOIN bounds b
      WHERE l.removed_at IS NOT NULL
        AND l.removed_at BETWEEN b.start_ms AND b.end_ms
    ),
    deduped_changes AS (
      SELECT DISTINCT ON (lc.listing_id, lc.changed_at, lc.changes::text)
             lc.listing_id, lc.changes
      FROM listing_changes lc
      CROSS JOIN bounds b
      WHERE lc.changed_at BETWEEN b.start_ms AND b.end_ms
      ORDER BY lc.listing_id, lc.changed_at, lc.changes::text, lc.id DESC
    ),
    day_events AS (
      SELECT COALESCE(l.owner_id, $3) AS owner_id,
             o.name AS owner_name,
             o.profile_url AS owner_profile_url,
             'added'::text AS action
      FROM listings l
      LEFT JOIN owners o ON o.id = l.owner_id
      CROSS JOIN bounds b
      WHERE l.first_seen_at BETWEEN b.start_ms AND b.end_ms

      UNION ALL

      SELECT COALESCE(l.owner_id, $3),
             o.name,
             o.profile_url,
             'removed'
      FROM listings l
      LEFT JOIN owners o ON o.id = l.owner_id
      CROSS JOIN bounds b
      WHERE l.removed_at BETWEEN b.start_ms AND b.end_ms

      UNION ALL

      SELECT COALESCE(l.owner_id, $3),
             o.name,
             o.profile_url,
             ${CHANGE_ACTION_SQL}
      FROM deduped_changes dc
      JOIN listings l ON l.id = dc.listing_id
      LEFT JOIN owners o ON o.id = l.owner_id
      CROSS JOIN LATERAL jsonb_array_elements(dc.changes) AS elem
      WHERE NOT (
        (
          (elem->>'field' = 'isRemoved' AND elem->>'to' = 'true')
          OR (elem->>'field' = 'enrichmentStatus' AND elem->>'to' = 'removed')
        )
        AND EXISTS (SELECT 1 FROM removed_listings rl WHERE rl.listing_id = dc.listing_id)
      )
    )
    SELECT owner_id,
           MAX(owner_name) AS owner_name,
           MAX(owner_profile_url) AS owner_profile_url,
           COUNT(*) FILTER (WHERE action = 'added')::int AS added,
           COUNT(*) FILTER (WHERE action = 'removed')::int AS removed,
           COUNT(*) FILTER (WHERE action = 'price')::int AS price,
           COUNT(*) FILTER (WHERE action = 'images')::int AS images,
           COUNT(*) FILTER (WHERE action = 'title')::int AS title,
           COUNT(*) FILTER (WHERE action = 'description')::int AS description,
           COUNT(*) FILTER (WHERE action = 'location')::int AS location,
           COUNT(*) FILTER (WHERE action = 'other')::int AS other,
           COUNT(*)::int AS total
    FROM day_events
    GROUP BY owner_id
    `,
    [start, end, UNKNOWN_OWNER_ID],
  )

  const summaries: OwnerDaySummary[] = rows.map((row) => ({
    ownerId: row.owner_id,
    ownerName: row.owner_name ?? undefined,
    ownerProfileUrl: row.owner_profile_url ?? undefined,
    reputation: UNKNOWN_OWNER_REPUTATION,
    counts: {
      added: row.added,
      removed: row.removed,
      price: row.price,
      images: row.images,
      title: row.title,
      description: row.description,
      location: row.location,
      other: row.other,
      total: row.total,
    },
  }))

  const reputationById = await fetchOwnerReputationMap(summaries.map((row) => row.ownerId))
  for (const summary of summaries) {
    summary.reputation = reputationById.get(summary.ownerId) ?? UNKNOWN_OWNER_REPUTATION
  }

  return summaries.sort((a, b) =>
    compareOwnerReputation(
      a.reputation,
      b.reputation,
      a.reputation.rating ?? 0,
      b.reputation.rating ?? 0,
      a.reputation.reviewCount ?? 0,
      b.reputation.reviewCount ?? 0,
    ),
  )
}

function addOwnerCounts(target: OwnerActionCounts, source: OwnerActionCounts): void {
  target.added += source.added
  target.removed += source.removed
  target.price += source.price
  target.images += source.images
  target.title += source.title
  target.description += source.description
  target.location += source.location
  target.other += source.other
  target.total += source.total
}

function buildDayActivitySummaryFromOwners(owners: OwnerDaySummary[]): DayActivitySummary {
  const totals = emptyOwnerCounts()
  const tierCounts = new Map<string, OwnerActionCounts>()
  const tierOwners = new Map<string, Set<string>>()

  for (const definition of REPUTATION_TIER_DEFINITIONS) {
    tierCounts.set(definition.tier, emptyOwnerCounts())
    tierOwners.set(definition.tier, new Set())
  }

  for (const owner of owners) {
    const tier = reputationTierForEvent(
      owner.ownerId === UNKNOWN_OWNER_ID ? undefined : owner.ownerId,
      owner.reputation,
    )
    tierOwners.get(tier)!.add(owner.ownerId)
    addOwnerCounts(totals, owner.counts)
    addOwnerCounts(tierCounts.get(tier)!, owner.counts)
  }

  return {
    totals,
    ownerCount: owners.length,
    byReputation: REPUTATION_TIER_DEFINITIONS.map((definition) => ({
      tier: definition.tier,
      label: definition.label,
      minScore: definition.minScore,
      maxScore: definition.maxScore,
      ownerCount: tierOwners.get(definition.tier)!.size,
      counts: tierCounts.get(definition.tier)!,
    })),
  }
}

async function fetchOwnerReputationMap(ownerIds: string[]) {
  const knownIds = ownerIds.filter((id) => id !== UNKNOWN_OWNER_ID)
  const reputationById = new Map<string, OwnerReputation>()

  if (knownIds.length === 0) return reputationById

  const { rows } = await pool.query<{
    id: string
    rating: number | null
    review_count: number | null
    is_verified_company: boolean | null
    site_posts_count: number | null
    scraped_posts_count: string
  }>(
    `SELECT o.id, o.rating, o.review_count, o.is_verified_company, o.site_posts_count,
            COUNT(l.id)::text AS scraped_posts_count
     FROM owners o
     LEFT JOIN listings l ON l.owner_id = o.id
     WHERE o.id = ANY($1::text[])
     GROUP BY o.id`,
    [knownIds],
  )

  for (const row of rows) {
    reputationById.set(
      row.id,
      computeOwnerReputation({
        rating: row.rating,
        reviewCount: row.review_count,
        isVerifiedCompany: row.is_verified_company,
        sitePostsCount: row.site_posts_count,
        scrapedPostsCount: Number(row.scraped_posts_count),
      }),
    )
  }

  return reputationById
}

const UNKNOWN_OWNER_REPUTATION: OwnerReputation = {
  score: 0,
  label: 'Low data',
}

async function buildOwnerSummaries(events: HistoryEvent[]): Promise<OwnerDaySummary[]> {
  const byOwner = new Map<string, OwnerDaySummary>()

  for (const event of events) {
    const key = ownerKey(event.ownerId)
    let summary = byOwner.get(key)
    if (!summary) {
      summary = {
        ownerId: key,
        ownerName: event.ownerName,
        ownerProfileUrl: event.ownerProfileUrl,
        reputation: UNKNOWN_OWNER_REPUTATION,
        counts: emptyOwnerCounts(),
      }
      byOwner.set(key, summary)
    }

    summary.counts[event.action] += 1
    summary.counts.total += 1
  }

  const reputationById = await fetchOwnerReputationMap([...byOwner.keys()])
  for (const summary of byOwner.values()) {
    summary.reputation = reputationById.get(summary.ownerId) ?? UNKNOWN_OWNER_REPUTATION
  }

  return [...byOwner.values()].sort((a, b) =>
    compareOwnerReputation(
      a.reputation,
      b.reputation,
      a.reputation.rating ?? 0,
      b.reputation.rating ?? 0,
      a.reputation.reviewCount ?? 0,
      b.reputation.reviewCount ?? 0,
    ),
  )
}

export async function getOwnerActivitySummaries(
  fromMs: number,
  toMs?: number,
): Promise<OwnerDaySummary[]> {
  const events = await collectEvents(fromMs, toMs)
  return buildOwnerSummaries(events)
}

function snapActionOffsetToOwnerBoundary(
  owners: OwnerDaySummary[],
  actionOffset: number,
): number {
  let cursor = 0
  for (const owner of owners) {
    const end = cursor + owner.counts.total
    if (actionOffset > cursor && actionOffset < end) {
      return end
    }
    cursor = end
  }
  return actionOffset
}

function paginateOwnersByActionBudget(
  owners: OwnerDaySummary[],
  actionOffset: number,
  actionLimit: number,
): {
  owners: OwnerDaySummary[]
  nextActionOffset: number
  loadedActionCount: number
  hasMore: boolean
} {
  const totalActions = owners.reduce((sum, owner) => sum + owner.counts.total, 0)
  const boundedOffset = Math.max(0, Math.min(actionOffset, totalActions))
  const startOffset = snapActionOffsetToOwnerBoundary(owners, boundedOffset)

  if (startOffset >= totalActions || owners.length === 0) {
    return {
      owners: [],
      nextActionOffset: totalActions,
      loadedActionCount: 0,
      hasMore: false,
    }
  }

  let cursor = 0
  let ownerIndex = 0
  while (ownerIndex < owners.length && cursor + owners[ownerIndex].counts.total <= startOffset) {
    cursor += owners[ownerIndex].counts.total
    ownerIndex++
  }

  const pageOwners: OwnerDaySummary[] = []
  let budget = actionLimit
  let loadedActionCount = 0

  while (ownerIndex < owners.length && budget > 0) {
    const owner = owners[ownerIndex]
    const ownerTotal = owner.counts.total

    if (pageOwners.length === 0 && ownerTotal > actionLimit) {
      pageOwners.push(owner)
      loadedActionCount = actionLimit
      const nextActionOffset = Math.min(startOffset + actionLimit, totalActions)
      return {
        owners: pageOwners,
        nextActionOffset,
        loadedActionCount,
        hasMore: nextActionOffset < totalActions,
      }
    }

    if (ownerTotal <= budget) {
      pageOwners.push(owner)
      budget -= ownerTotal
      loadedActionCount += ownerTotal
      cursor += ownerTotal
      ownerIndex++
      continue
    }

    if (pageOwners.length === 0) {
      pageOwners.push(owner)
      loadedActionCount = actionLimit
      const nextActionOffset = Math.min(startOffset + actionLimit, totalActions)
      return {
        owners: pageOwners,
        nextActionOffset,
        loadedActionCount,
        hasMore: nextActionOffset < totalActions,
      }
    }

    break
  }

  const nextActionOffset = snapActionOffsetToOwnerBoundary(owners, startOffset + loadedActionCount)
  return {
    owners: pageOwners,
    nextActionOffset: Math.max(nextActionOffset, startOffset + loadedActionCount),
    loadedActionCount,
    hasMore: nextActionOffset < totalActions,
  }
}

export async function getDayActivitySummary(date: string): Promise<DayActivitySummaryPage> {
  const { start, end } = dayBounds(date)
  const owners = await fetchDayOwnerActionRows(start, end)
  const summary = buildDayActivitySummaryFromOwners(owners)

  return {
    date,
    label: dayLabel(date),
    summary,
  }
}

export async function getDayOwnerSummaries(
  date: string,
  actionOffset = 0,
  actionLimit: number = HISTORY_PAGE_SIZE,
): Promise<DayOwnersPage> {
  const safeLimit = Math.min(Math.max(actionLimit, 1), 200)
  const { start, end } = dayBounds(date)
  const allOwners = await fetchDayOwnerActionRows(start, end)
  const totalActions = allOwners.reduce((sum, owner) => sum + owner.counts.total, 0)
  const page = paginateOwnersByActionBudget(allOwners, actionOffset, safeLimit)

  return {
    date,
    label: dayLabel(date),
    owners: page.owners,
    totalOwners: allOwners.length,
    totalActions,
    actionOffset,
    actionLimit: safeLimit,
    nextActionOffset: page.nextActionOffset,
    hasMore: page.hasMore,
    loadedActionCount: page.loadedActionCount,
  }
}

export async function getOwnerDayEventsPage(
  date: string,
  ownerId: string,
  page: number,
  limit: number = HISTORY_PAGE_SIZE,
): Promise<OwnerDayEventsPage> {
  const safeLimit = Math.min(Math.max(limit, 1), 200)
  const safePage = Math.max(page, 1)
  const { start, end } = dayBounds(date)

  const allEvents = await collectEvents(start, end)
  const events = allEvents.filter((event) => ownerKey(event.ownerId) === ownerId)
  const total = events.length
  const totalPages = Math.max(1, Math.ceil(total / safeLimit))
  const offset = (safePage - 1) * safeLimit
  const first = events[0]

  return {
    date,
    label: dayLabel(date),
    ownerId,
    ownerName: first?.ownerName,
    ownerProfileUrl: first?.ownerProfileUrl,
    events: events.slice(offset, offset + safeLimit),
    page: safePage,
    limit: safeLimit,
    total,
    totalPages,
  }
}

export async function getDayEventsPage(
  date: string,
  page: number,
  limit: number = HISTORY_PAGE_SIZE,
): Promise<DayEventsPage> {
  const safeLimit = Math.min(Math.max(limit, 1), 200)
  const safePage = Math.max(page, 1)
  const { start, end } = dayBounds(date)

  const events = await collectEvents(start, end)
  const total = events.length
  const totalPages = Math.max(1, Math.ceil(total / safeLimit))
  const offset = (safePage - 1) * safeLimit

  return {
    date,
    label: dayLabel(date),
    events: events.slice(offset, offset + safeLimit),
    page: safePage,
    limit: safeLimit,
    total,
    totalPages,
  }
}
