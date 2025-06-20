import { Icon } from 'copilot-design-system'

export default function DropDownIcon({
  isOpen,
  className = '',
}: {
  isOpen: boolean
  className?: string
}) {
  return (
    <Icon
      icon="ChevronDown"
      width={16}
      height={16}
      className={`transition-transform ${className} ${isOpen ? 'rotate-180' : ''}`}
    />
  )
}
