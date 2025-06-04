import TimeAgo from 'javascript-time-ago'
import en from 'javascript-time-ago/locale/en.json'

TimeAgo.addLocale(en)

const timeAgo = new TimeAgo('en-US')

export const getTimeAgo = (date: string | null): string | null => {
  if (!date) return null

  const sanitizedCreatedAt = date.match(/Z|[+-]\d{2}:\d{2}$/)
    ? date
    : `${date}Z`

  try {
    const parsedDate = new Date(sanitizedCreatedAt)
    return timeAgo.format(parsedDate)
  } catch {
    return null
  }
}
