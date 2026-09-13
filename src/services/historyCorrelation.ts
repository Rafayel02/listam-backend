import {
  getOwnerActivitySummaries,
  UNKNOWN_OWNER_ID,
  type OwnerActionCategory,
  type OwnerDaySummary,
} from './dailyHistory.js'

export interface CorrelationCell {
  x: string
  y: string
  value: number
}

export interface ActionCorrelation {
  action: OwnerActionCategory | 'total' | 'updates'
  label: string
  r: number
  n: number
}

export interface ReputationTierStat {
  label: string
  minScore: number
  ownerCount: number
  avgAdded: number
  avgRemoved: number
  avgPrice: number
  avgImages: number
  avgTotal: number
}

export interface ReputationScatterPoint {
  id: string
  x: number
  y: number
  label: string
}

export interface ReputationChangeCorrelation {
  days: number
  ownerCount: number
  totalEvents: number
  reputationCorrelations: ActionCorrelation[]
  correlationLabels: string[]
  correlationMatrix: CorrelationCell[]
  tiers: ReputationTierStat[]
  scatterTotal: ReputationScatterPoint[]
  scatterPrice: ReputationScatterPoint[]
}

const ACTION_METRICS: { action: OwnerActionCategory | 'total' | 'updates'; label: string }[] = [
  { action: 'added', label: 'Added' },
  { action: 'removed', label: 'Removed' },
  { action: 'price', label: 'Price' },
  { action: 'images', label: 'Images' },
  { action: 'updates', label: 'Updates' },
  { action: 'total', label: 'Total' },
]

const MATRIX_LABELS = ['Reputation', 'Added', 'Removed', 'Price', 'Images', 'Total']

const TIER_BUCKETS = [
  { label: 'Very reliable', minScore: 75 },
  { label: 'Reliable', minScore: 55 },
  { label: 'Moderate', minScore: 35 },
  { label: 'Low data', minScore: 0 },
] as const

function average(values: number[]): number {
  if (values.length === 0) return 0
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function pearson(xs: number[], ys: number[]): number {
  if (xs.length < 3 || ys.length < 3 || xs.length !== ys.length) return 0
  const xMean = average(xs)
  const yMean = average(ys)
  let num = 0
  let xDen = 0
  let yDen = 0
  for (let i = 0; i < xs.length; i++) {
    const xDiff = xs[i]! - xMean
    const yDiff = ys[i]! - yMean
    num += xDiff * yDiff
    xDen += xDiff * xDiff
    yDen += yDiff * yDiff
  }
  const den = Math.sqrt(xDen * yDen)
  return den === 0 ? 0 : num / den
}

function metricValue(
  owner: OwnerDaySummary,
  action: OwnerActionCategory | 'total' | 'updates',
): number {
  if (action === 'total') return owner.counts.total
  if (action === 'updates') {
    return (
      owner.counts.price +
      owner.counts.images +
      owner.counts.title +
      owner.counts.description +
      owner.counts.location +
      owner.counts.other
    )
  }
  return owner.counts[action]
}

function ownerMetricSeries(
  owners: OwnerDaySummary[],
  action: OwnerActionCategory | 'total' | 'updates',
): number[] {
  return owners.map((owner) => metricValue(owner, action))
}

function buildCorrelationMatrix(owners: OwnerDaySummary[]): {
  labels: string[]
  cells: CorrelationCell[]
} {
  const series = new Map<string, number[]>()
  series.set('Reputation', owners.map((owner) => owner.reputation.score))
  series.set('Added', ownerMetricSeries(owners, 'added'))
  series.set('Removed', ownerMetricSeries(owners, 'removed'))
  series.set('Price', ownerMetricSeries(owners, 'price'))
  series.set('Images', ownerMetricSeries(owners, 'images'))
  series.set('Total', ownerMetricSeries(owners, 'total'))

  const cells: CorrelationCell[] = []
  for (const rowLabel of MATRIX_LABELS) {
    for (const colLabel of MATRIX_LABELS) {
      const xs = series.get(colLabel) ?? []
      const ys = series.get(rowLabel) ?? []
      cells.push({
        x: colLabel,
        y: rowLabel,
        value: pearson(xs, ys),
      })
    }
  }

  return { labels: MATRIX_LABELS, cells }
}

function buildTierStats(owners: OwnerDaySummary[]): ReputationTierStat[] {
  return TIER_BUCKETS.map((bucket, index) => {
    const maxScore = index === 0 ? 100 : TIER_BUCKETS[index - 1]!.minScore - 1
    const bucketOwners = owners.filter(
      (owner) =>
        owner.reputation.score >= bucket.minScore && owner.reputation.score <= maxScore,
    )

    return {
      label: bucket.label,
      minScore: bucket.minScore,
      ownerCount: bucketOwners.length,
      avgAdded: average(bucketOwners.map((owner) => owner.counts.added)),
      avgRemoved: average(bucketOwners.map((owner) => owner.counts.removed)),
      avgPrice: average(bucketOwners.map((owner) => owner.counts.price)),
      avgImages: average(bucketOwners.map((owner) => owner.counts.images)),
      avgTotal: average(bucketOwners.map((owner) => owner.counts.total)),
    }
  })
}

function buildScatter(
  owners: OwnerDaySummary[],
  action: OwnerActionCategory | 'total',
): ReputationScatterPoint[] {
  return owners.map((owner) => ({
    id: owner.ownerId,
    x: owner.reputation.score,
    y: metricValue(owner, action),
    label: owner.ownerName || owner.ownerId,
  }))
}

export async function getReputationChangeCorrelation(
  days: number,
): Promise<ReputationChangeCorrelation> {
  const safeDays = Math.min(Math.max(days, 1), 90)
  const fromMs = Date.now() - safeDays * 24 * 60 * 60 * 1000
  const owners = (await getOwnerActivitySummaries(fromMs)).filter(
    (owner) => owner.ownerId !== UNKNOWN_OWNER_ID,
  )

  const reputationScores = owners.map((owner) => owner.reputation.score)
  const reputationCorrelations = ACTION_METRICS.map(({ action, label }) => ({
    action,
    label,
    r: pearson(reputationScores, ownerMetricSeries(owners, action)),
    n: owners.length,
  }))

  const matrix = buildCorrelationMatrix(owners)
  const totalEvents = owners.reduce((sum, owner) => sum + owner.counts.total, 0)

  return {
    days: safeDays,
    ownerCount: owners.length,
    totalEvents,
    reputationCorrelations,
    correlationLabels: matrix.labels,
    correlationMatrix: matrix.cells,
    tiers: buildTierStats(owners),
    scatterTotal: buildScatter(owners, 'total'),
    scatterPrice: buildScatter(owners, 'price'),
  }
}
