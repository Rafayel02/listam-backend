export interface FieldChange {
  field: string
  from: unknown
  to: unknown
}

function formatValue(value: unknown): string {
  if (value === undefined || value === null) return '—'
  if (typeof value === 'string') {
    return value.length > 80 ? `${value.slice(0, 77)}…` : value
  }
  if (typeof value === 'number') {
    if (value > 1_000_000_000) return new Date(value).toLocaleDateString('en-GB')
    return value.toLocaleString()
  }
  if (typeof value === 'boolean') return value ? 'yes' : 'no'
  if (Array.isArray(value)) return value.length === 1 ? String(value[0]) : `${value.length} items`
  const json = JSON.stringify(value)
  return json.length > 80 ? `${json.slice(0, 77)}…` : json
}

export function summarizeFieldChange(change: FieldChange): string {
  const field = change.field

  if (field === 'isRemoved' && change.to === true) return 'removed'
  if (field === 'enrichmentStatus' && change.to === 'removed') return 'removed'
  if (field === 'price') {
    return `price changed from ${formatValue(change.from)} to ${formatValue(change.to)}`
  }
  if (field === 'renewedAt') {
    return `renewal date updated from ${formatValue(change.from)} to ${formatValue(change.to)}`
  }
  if (field === 'postedAt') {
    return `posted date updated from ${formatValue(change.from)} to ${formatValue(change.to)}`
  }
  if (field === 'currency') {
    return `currency changed from ${formatValue(change.from)} to ${formatValue(change.to)}`
  }
  if (field === 'title') {
    return `title updated`
  }
  if (field === 'description') {
    return `description updated`
  }
  if (field === 'district' || field === 'street') {
    return `${field} changed from ${formatValue(change.from)} to ${formatValue(change.to)}`
  }
  if (field === 'rooms' || field === 'areaSqm') {
    return `${field} changed from ${formatValue(change.from)} to ${formatValue(change.to)}`
  }
  if (field.startsWith('sourcePriceHistory')) {
    return `price history updated`
  }
  if (field.startsWith('imageUrls')) {
    return `images updated`
  }

  return `${field} changed from ${formatValue(change.from)} to ${formatValue(change.to)}`
}
