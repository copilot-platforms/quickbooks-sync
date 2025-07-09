import { TimeInterval } from '@/type/copilot'

export const getTimeInterval = (interval: string, intervalCount: number) => {
  switch (interval) {
    case 'day':
      return TimeInterval.DAILY
    case 'week':
      return TimeInterval.WEEKLY
    case 'month':
      if (intervalCount === 24) {
        return TimeInterval.EVERY_TWO_YEARS
      } else if (intervalCount === 3) {
        return TimeInterval.QUARTERLY
      } else if (intervalCount === 6) {
        return TimeInterval.BIANNUALLY
      }
      return TimeInterval.MONTHLY
    case 'year':
      return TimeInterval.YEARLY
    default:
      return TimeInterval.MONTHLY
  }
}
