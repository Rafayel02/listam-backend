import { pool } from '../db.js'
import { summarizeFieldChange, type FieldChange } from '../utils/changeFormat.js'

export type HistoryEventKind = 'added' | 'removed' | 'updated'

export interface HistoryEvent {
  id: string
  kind: HistoryEventKind
  listingId: string
  title?: string
  url: string
  summary: string
  changedAt: number
  date: string
}

export interface DaySummary {
  date: string
  label: string
  totalEvents: number
}

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

async function fetchChangeRows(fromMs: number, toMs?: number) {
  const params = toMs != null ? [fromMs, toMs] : [fromMs]
  const bound = toMs != null ? 'AND lc.changed_at <= $2' : ''
  return pool.query<{
    listing_id: string
    changed_at: string
    changes: FieldChange[]
    title: string | null
    url: string
  }>(
    `SELECT DISTINCT ON (lc.listing_id, lc.changed_at, lc.changes::text)
            lc.listing_id, lc.changed_at, lc.changes, l.title, l.url
     FROM listing_changes lc
     JOIN listings l ON l.id = lc.listing_id
     WHERE lc.changed_at >= $1 ${bound}
     ORDER BY lc.listing_id, lc.changed_at, lc.changes::text, lc.id DESC`,
    params,
  )
}

async function fetchAddedRows(fromMs: number, toMs?: number) {
  const params = toMs != null ? [fromMs, toMs] : [fromMs]
  const bound = toMs != null ? 'AND first_seen_at <= $2' : ''
  return pool.query<{ id: string; title: string | null; url: string; first_seen_at: string }>(
    `SELECT id, title, url, first_seen_at
     FROM listings
     WHERE first_seen_at >= $1 ${bound}`,
    params,
  )
}

async function fetchRemovedRows(fromMs: number, toMs?: number) {
  const params = toMs != null ? [fromMs, toMs] : [fromMs]
  const bound = toMs != null ? 'AND removed_at <= $2' : ''
  return pool.query<{ id: string; title: string | null; url: string; removed_at: string }>(
    `SELECT id, title, url, removed_at
     FROM listings
     WHERE removed_at IS NOT NULL AND removed_at >= $1 ${bound}`,
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
    events.push({
      id: eventId(['added', row.id, String(changedAt)]),
      kind: 'added',
      listingId: row.id,
      title: row.title ?? undefined,
      url: row.url,
      summary: 'added',
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
      changedAt,
      date,
    })
  }

  for (const row of changeRows) {
    const changedAt = Number(row.changed_at)
    const date = dayKey(changedAt)
    const changes = Array.isArray(row.changes) ? row.changes : []

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
          changedAt,
          date,
        })
        continue
      }

      events.push({
        id: eventId(['updated', row.listing_id, String(changedAt), change.field]),
        kind: 'updated',
        listingId: row.listing_id,
        title: row.title ?? undefined,
        url: row.url,
        summary,
        changedAt,
        date,
      })
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

export async function getDaySummaries(days: number): Promise<{
  days: DaySummary[]
  totalEvents: number
}> {
  const safeDays = Math.min(Math.max(days, 1), 90)
  const fromMs = Date.now() - safeDays * 24 * 60 * 60 * 1000
  const events = await collectEvents(fromMs)

  const counts = new Map<string, number>()
  for (const event of events) {
    counts.set(event.date, (counts.get(event.date) ?? 0) + 1)
  }

  const daysList = [...counts.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([date, totalEvents]) => ({
      date,
      label: dayLabel(date),
      totalEvents,
    }))

  return {
    days: daysList,
    totalEvents: events.length,
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
