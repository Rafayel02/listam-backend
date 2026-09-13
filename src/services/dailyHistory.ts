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

export interface DailyHistoryGroup {
  date: string
  label: string
  events: HistoryEvent[]
}

function dayKey(ms: number): string {
  const d = new Date(ms)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function dayLabel(dateKey: string): string {
  const [y, m, d] = dateKey.split('-')
  return `${d}.${m}.${y}`
}

function eventId(parts: string[]): string {
  return parts.join(':')
}

export async function buildDailyHistory(days: number): Promise<DailyHistoryGroup[]> {
  const safeDays = Math.min(Math.max(days, 1), 90)
  const now = Date.now()
  const fromMs = now - safeDays * 24 * 60 * 60 * 1000

  const [changeRows, addedRows, removedRows] = await Promise.all([
    pool.query<{
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
       WHERE lc.changed_at >= $1
       ORDER BY lc.listing_id, lc.changed_at, lc.changes::text, lc.id DESC`,
      [fromMs],
    ),
    pool.query<{ id: string; title: string | null; url: string; first_seen_at: string }>(
      `SELECT id, title, url, first_seen_at
       FROM listings
       WHERE first_seen_at >= $1`,
      [fromMs],
    ),
    pool.query<{ id: string; title: string | null; url: string; removed_at: string }>(
      `SELECT id, title, url, removed_at
       FROM listings
       WHERE removed_at IS NOT NULL AND removed_at >= $1`,
      [fromMs],
    ),
  ])

  const events: HistoryEvent[] = []
  const removedKeys = new Set<string>()

  for (const row of addedRows.rows) {
    const changedAt = Number(row.first_seen_at)
    const date = dayKey(changedAt)
    events.push({
      id: eventId(['added', row.id, String(changedAt)]),
      kind: 'added',
      listingId: row.id,
      title: row.title ?? undefined,
      url: row.url,
      summary: 'added',
      changedAt,
      date,
    })
  }

  for (const row of removedRows.rows) {
    const changedAt = Number(row.removed_at)
    const date = dayKey(changedAt)
    const key = `${row.id}:${date}`
    removedKeys.add(key)
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

  for (const row of changeRows.rows) {
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

  events.sort((a, b) => b.changedAt - a.changedAt)

  const byDate = new Map<string, HistoryEvent[]>()
  for (const event of events) {
    if (!byDate.has(event.date)) byDate.set(event.date, [])
    byDate.get(event.date)!.push(event)
  }

  return [...byDate.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([date, dayEvents]) => ({
      date,
      label: dayLabel(date),
      events: dayEvents.sort((a, b) => b.changedAt - a.changedAt),
    }))
}
