'use client'
import { Heading, Icon } from 'copilot-design-system'
import { ReactElement, ReactNode } from 'react'

type AccordionProps = {
  item: {
    id: string
    header: ({ isOpen }: { isOpen: boolean }) => ReactNode
    content: ReactElement
  }
  toggleItemAction: (itemId: string) => void
  isOpen: boolean
}

export default function Accordion({
  item,
  toggleItemAction,
  isOpen,
}: AccordionProps) {
  const HeaderComponent = item.header
  return (
    <div className="mx-auto">
      {/* Header - Clickable to toggle */}
      <div
        className="flex items-center justify-start py-[14] pr-3 cursor-pointer"
        onClick={() => toggleItemAction(item.id)}
      >
        <HeaderComponent isOpen={isOpen} />
      </div>

      {/* Content - Conditionally visible with smooth animation */}
      {isOpen && (
        <div className="animate-in slide-in-from-top-2 duration-200">
          {item.content}
        </div>
      )}
    </div>
  )
}
