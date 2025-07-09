'use client'
import { Heading, Icon } from 'copilot-design-system'
import { ReactElement } from 'react'

type AccordionProps = {
  item: {
    id: string
    header: string
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
  return (
    <div className="mx-auto">
      <div
        className="flex items-center justify-start py-[14px] pr-3 cursor-pointer"
        onClick={() => toggleItemAction(item.id)}
      >
        <Heading size="lg">{item.header}</Heading>
        {/* Chevron rotates based on open state */}
        <div
          className={`transform transition-transform duration-150 ease-in-out p-1.5 ${
            isOpen ? 'rotate-90' : ''
          }`}
        >
          <Icon icon="ChevronRight" width={16} height={16} />
        </div>
      </div>

      {/* Content - Conditionally visible with smooth animation */}
      <div
        className={`animate-in slide-in-from-top-2 duration-200 ${isOpen ? 'block' : 'hidden'}`}
      >
        {item.content}
      </div>
    </div>
  )
}
