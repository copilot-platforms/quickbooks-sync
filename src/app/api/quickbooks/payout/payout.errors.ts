import { getShouldRetryForCategory } from '@/utils/synclog'
import { getMessageAndCodeFromError } from '@/utils/error'

// Payout problems that retrying will never fix, so we stop trying
// (refund lines, negative fee, duplicate line items, wrong total).
export class TerminalPayoutError extends Error {}

// A payout that mixes batched and non-batched invoices. Extends
// TerminalPayoutError so it also stops retrying, but stays its own type so
// we can send the special "mixed payout" alert.
export class MixedPayoutIntentError extends TerminalPayoutError {}

// Terminal payout problems never retry. Everything else (invoice not saved
// yet, missing bank ref, rate-limit, QB 5xx, suspended account) uses the
// shared rule, which still stops on dead tokens (AUTH).
export function getShouldRetryForPayout(error: unknown): boolean {
  if (error instanceof TerminalPayoutError) return false
  return getShouldRetryForCategory(getMessageAndCodeFromError(error))
}
