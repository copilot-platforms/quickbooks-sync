import { Button, Heading, Icon } from 'copilot-design-system'

export default function ProductMappingHeader({ isOpen }: { isOpen: boolean }) {
  return (
    <div className="w-full sm:flex items-center justify-between">
      <div className="flex items-center">
        <Heading size="lg">Product Mapping</Heading>
        {/* Chevron rotates based on open state */}
        <div className="p-1.5">
          <Icon
            icon="ChevronDown"
            width={16}
            height={16}
            className={`transition-transform ${isOpen ? 'rotate-180' : ''}`}
          />
        </div>
      </div>
      <Button
        label="Confirm"
        variant="primary"
        prefixIcon="Check"
        className="mt-1 sm:mt-0"
      />
    </div>
  )
}
