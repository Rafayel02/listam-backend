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

const DAY_KEY_SQL = `to_char(to_timestamp(ms / 1000.0), 'YYYY-MM-DD')`

const DAY_SUMMARY_COUNTS_SQL = `
WITH bounds AS (
  SELECT $1::bigint AS from_ms
),
added AS (
  SELECT ${DAY_KEY_SQL.replace('ms', 'l.first_seen_at')} AS day,
         COUNT(*)::int AS cnt
  FROM listings l
  CROSS JOIN bounds b
  WHERE l.first_seen_at >= b.from_ms
  GROUP BY 1
),
removed_rows AS (
  SELECT l.id AS listing_id,
         ${DAY_KEY_SQL.replace('ms', 'l.removed_at')} AS day
  FROM listings l
  CROSS JOIN bounds b
  WHERE l.removed_at IS NOT NULL
    AND l.removed_at >= b.from_ms
),
removed AS (
  SELECT day, COUNT(*)::int AS cnt
  FROM removed_rows
  GROUP BY day
),
deduped_changes AS (
  SELECT DISTINCT ON (lc.listing_id, lc.changed_at, lc.changes::text)
         lc.listing_id,
         lc.changed_at,
         lc.changes
  FROM listing_changes lc
  CROSS JOIN bounds b
  WHERE lc.changed_at >= b.from_ms
  ORDER BY lc.listing_id, lc.changed_at, lc.changes::text, lc.id DESC
),
expanded AS (
  SELECT dc.listing_id,
         ${DAY_KEY_SQL.replace('ms', 'dc.changed_at')} AS day,
         elem AS change
  FROM deduped_changes dc
  CROSS JOIN LATERAL jsonb_array_elements(dc.changes) AS elem
),
classified AS (
  SELECT e.day,
         e.listing_id,
         (
           (e.change->>'field' = 'isRemoved' AND e.change->>'to' = 'true')
           OR (e.change->>'field' = 'enrichmentStatus' AND e.change->>'to' = 'removed')
         ) AS is_removal
  FROM expanded e
),
change_removals AS (
  SELECT DISTINCT ON (day, listing_id) day, listing_id
  FROM classified
  WHERE is_removal
  ORDER BY day, listing_id
),
change_removal_counts AS (
  SELECT cr.day, COUNT(*)::int AS cnt
  FROM change_removals cr
  WHERE NOT EXISTS (
    SELECT 1
    FROM removed_rows rr
    WHERE rr.listing_id = cr.listing_id
      AND rr.day = cr.day
  )
  GROUP BY cr.day
),
change_update_counts AS (
  SELECT day, COUNT(*)::int AS cnt
  FROM classified
  WHERE NOT is_removal
  GROUP BY day
),
all_days AS (
  SELECT day FROM added
  UNION
  SELECT day FROM removed
  UNION
  SELECT day FROM change_removal_counts
  UNION
  SELECT day FROM change_update_counts
)
SELECT d.day AS date,
       (
         COALESCE(a.cnt, 0)
         + COALESCE(r.cnt, 0)
         + COALESCE(cr.cnt, 0)
         + COALESCE(cu.cnt, 0)
       )::int AS total_events
FROM all_days d
LEFT JOIN added a ON a.day = d.day
LEFT JOIN removed r ON r.day = d.day
LEFT JOIN change_removal_counts cr ON cr.day = d.day
LEFT JOIN change_update_counts cu ON cu.day = d.day
ORDER BY d.day DESC
`

async function fetchDaySummaryCounts(
  fromMs: number,
): Promise<{ date: string; totalEvents: number }[]> {
  const { rows } = await pool.query<{ date: string; total_events: number }>(
    DAY_SUMMARY_COUNTS_SQL,
    [fromMs],
  )
  return rows.map((row) => ({
    date: row.date,
    totalEvents: Number(row.total_events),
  }))
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
  const events = await collectEvents(start, end)
  const summary = await buildDayActivitySummary(events)

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
  const events = await collectEvents(start, end)

  const allOwners = await buildOwnerSummaries(events)
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
