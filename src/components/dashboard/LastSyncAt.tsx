import ReactTimeAgo from 'react-time-ago'

export default function LastSyncAt({ date }: { date: string | null }) {
  if (!date) return <> </>
  const sanitized = date.match(/Z|[+-]\d{2}:\d{2}$/) ? date : `${date}Z`

  return (
    <>
      Last synced <ReactTimeAgo date={new Date(sanitized)} locale="en-US" />
    </>
  )
}
