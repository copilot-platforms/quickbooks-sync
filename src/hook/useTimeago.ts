import { useEffect, useState } from 'react'
import TimeAgo from 'javascript-time-ago'
import en from 'javascript-time-ago/locale/en.json'

TimeAgo.addLocale(en)
const timeAgo = new TimeAgo('en-US')
const refreshInterval = 60_000

export const useTimeAgo = (date: string | null): string | null => {
  const [timeAgoText, setTimeAgoText] = useState<string | null>(null)

  useEffect(() => {
    if (!date) return
    const sanitized = date.match(/Z|[+-]\d{2}:\d{2}$/) ? date : `${date}Z`
    const update = () => {
      setTimeAgoText(timeAgo.format(new Date(sanitized)))
    }
    update()
    const interval = setInterval(update, refreshInterval)
    return () => clearInterval(interval)
  }, [date, refreshInterval])

  return timeAgoText
}
