import TimeAgo from 'javascript-time-ago'
import en from 'javascript-time-ago/locale/en.json'

TimeAgo.addLocale(en)

const timeAgo = new TimeAgo('en-US')

export const getTimeAgo = (date: Date | string | null): string | null => {
  if (!date) return null
  return timeAgo.format(new Date(date))
}
