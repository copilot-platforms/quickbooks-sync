import ReactTimeAgo from 'react-time-ago'
import TimeAgo from 'javascript-time-ago'
import en from 'javascript-time-ago/locale/en'

TimeAgo.addDefaultLocale(en)

export default function LastSyncAt({ date }: { date: string | null }) {
  if (!date) return <> </>
  const sanitized = date.match(/Z|[+-]\d{2}:\d{2}$/) ? date : `${date}`

  return (
    <>
      Last synced <ReactTimeAgo date={new Date(sanitized)} locale="en-US" />
    </>
  )
}
