import { Spinner } from 'copilot-design-system'

export default function Loading() {
  return (
    <div className="loading-spinner h-screen flex items-center justify-center">
      <Spinner size={10} />
    </div>
  )
}
