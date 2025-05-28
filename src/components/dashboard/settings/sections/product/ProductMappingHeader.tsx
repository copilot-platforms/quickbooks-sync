import { Button, Heading, Icon, IconButton } from 'copilot-design-system'

export default function ProductMappingHeader({ isOpen }: { isOpen: boolean }) {
  return (
    <div className="w-full flex items-center justify-between">
      <div className="flex items-center">
        <Heading size="lg">Product Mapping</Heading>
        {/* Chevron rotates based on open state */}
        <div className="p-1.5">
          {isOpen ? (
            <Icon icon="ChevronDown" width={16} height={16} />
          ) : (
            <Icon icon="ChevronUp" width={16} height={16} />
          )}
        </div>
      </div>
      <Button label="Confirm" variant="primary" prefixIcon="Check" />
    </div>
  )
}
