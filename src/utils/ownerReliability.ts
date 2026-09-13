const BROKER_LISTING_THRESHOLD = 4

export interface OwnerReputationInput {
  rating?: number | null
  reviewCount?: number | null
  isVerifiedCompany?: boolean | null
  sitePostsCount?: number | null
  scrapedPostsCount?: number
}

export interface OwnerReputation {
  score: number
  label: string
  rating?: number
  reviewCount?: number
}

function getEffectivePostCount(owner: OwnerReputationInput, scrapedCount: number): number {
  return owner.sitePostsCount ?? scrapedCount
}

export function computeOwnerReputation(owner: OwnerReputationInput): OwnerReputation {
  const scrapedCount = owner.scrapedPostsCount ?? 1
  const listingCount = getEffectivePostCount(owner, scrapedCount)
  let score = 0

  if (owner.rating != null) {
    score += (owner.rating / 5) * 45
  }

  if (owner.reviewCount != null && owner.reviewCount > 0) {
    score += Math.min(30, Math.log10(owner.reviewCount + 1) * 15)
  }

  if (owner.isVerifiedCompany) {
    score += 15
  }

  if (listingCount >= BROKER_LISTING_THRESHOLD && owner.rating != null && owner.rating >= 4) {
    score += 5
  }

  if (
    listingCount <= 2 &&
    owner.rating != null &&
    owner.rating >= 4.5 &&
    (owner.reviewCount ?? 0) >= 1
  ) {
    score += 8
  }

  if (owner.rating == null && (owner.reviewCount == null || owner.reviewCount === 0)) {
    score -= 12
  }

  score = Math.max(0, Math.min(100, Math.round(score)))

  let label = 'Low data'
  if (score >= 75) label = 'Very reliable'
  else if (score >= 55) label = 'Reliable'
  else if (score >= 35) label = 'Moderate'

  return {
    score,
    label,
    rating: owner.rating ?? undefined,
    reviewCount: owner.reviewCount ?? undefined,
  }
}

export function compareOwnerReputation(
  left: OwnerReputation,
  right: OwnerReputation,
  leftRating = 0,
  rightRating = 0,
  leftReviews = 0,
  rightReviews = 0,
): number {
  if (right.score !== left.score) return right.score - left.score
  if (rightRating !== leftRating) return rightRating - leftRating
  return rightReviews - leftReviews
}
