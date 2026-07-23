import useClickOutside from '@/hook/useClickOutside'
import { AccountOption } from '@/type/common'
import { Icon } from 'copilot-design-system'
import { useRef, useState } from 'react'

export default function AccountSelect({
  label,
  description,
  value,
  options,
  placeholder,
  onChange,
}: {
  label: string
  description: string
  value: string
  options: AccountOption[] | undefined
  placeholder: string
  onChange: (id: string) => void
}) {
  const [isOpen, setIsOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)

  useClickOutside(dropdownRef, () => setIsOpen(false), [buttonRef])

  const loading = options === undefined
  const disabled = !options || options.length === 0
  const selected = options?.find((o) => o.id === value)
  // Defends against an account being deleted in QBO between load and save —
  // surfaces the stale id with a hint instead of silently snapping to empty.
  const optionMissing = !!value && !selected

  const labelId = `account-select-label-${label.replace(/\s+/g, '-').toLowerCase()}`
  return (
    <div className="mb-5">
      <label id={labelId} className="block text-sm font-medium mb-1">
        {label}
      </label>
      <p className="text-xs text-gray-500 mb-2">{description}</p>
      <div className="relative">
        <button
          ref={buttonRef}
          type="button"
          disabled={disabled}
          onClick={() => setIsOpen((v) => !v)}
          aria-haspopup="listbox"
          aria-expanded={isOpen}
          aria-labelledby={labelId}
          className="w-full bg-gray-100 hover:bg-gray-150 grid grid-cols-6 md:grid-cols-14 py-2 pl-4 pr-3 border border-gray-200 rounded text-left disabled:opacity-50 focus:outline-none focus:border-gray-200"
        >
          <div className="col-span-5 md:col-span-13 text-sm text-gray-600 break-all lg:break-normal">
            {selected ? (
              selected.name
            ) : optionMissing ? (
              <span className="text-gray-500">
                Please select {label.toLowerCase()}
              </span>
            ) : (
              <span className="text-gray-400">
                {loading
                  ? 'Loading accounts…'
                  : disabled
                    ? 'No matching accounts in QuickBooks'
                    : placeholder}
              </span>
            )}
          </div>
          <div className="col-span-1 ml-auto my-auto">
            <Icon
              icon="ChevronDown"
              width={16}
              height={16}
              className="text-gray-500"
            />
          </div>
        </button>
        {isOpen && !disabled && (
          <div
            ref={dropdownRef}
            role="listbox"
            aria-labelledby={labelId}
            className="absolute right-0 left-0 top-full mt-[-1px] bg-white border border-gray-150 !shadow-popover-050 rounded-sm z-100"
          >
            <div className="max-h-56 overflow-y-auto">
              {options?.map((o) => (
                <button
                  key={o.id}
                  type="button"
                  role="option"
                  aria-selected={o.id === value}
                  onClick={() => {
                    onChange(o.id)
                    setIsOpen(false)
                  }}
                  className="w-full px-3 py-1.5 text-sm hover:bg-gray-100 focus:outline-none transition-colors cursor-pointer text-left text-gray-600 line-clamp-1 break-all lg:break-normal"
                >
                  {o.name}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
