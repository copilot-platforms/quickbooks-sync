import { Heading, Icon } from 'copilot-design-system'

export default function InvoiceDetailHeader({ isOpen }: { isOpen: boolean }) {
  return (
    <>
      <Heading size="lg">Invoice Details</Heading>
      {/* Chevron rotates based on open state */}
      <div className="p-1.5">
        <Icon
          icon="ChevronDown"
          width={16}
          height={16}
          className={`transition-transform ${isOpen ? 'rotate-180' : ''}`}
        />
      </div>
    </>
  )
}
