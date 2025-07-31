import { Spinner } from 'copilot-design-system'

export default function Loader() {
  return (
    <div className="flex flex-col items-center justify-center space-y-2.5 py-10">
      <Spinner size={5} />
      <p className="text-gray-600 leading-5.5">Syncing with QuickBooks</p>
    </div>
  )
}
