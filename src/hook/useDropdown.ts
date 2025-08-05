import { useEffect } from 'react'

export function useDropdownPosition(
  openDropdowns: {
    [key: number]: boolean
  },
  dropdownRef: React.RefObject<HTMLElement | null>,
) {
  useEffect(() => {
    Object.entries(openDropdowns).forEach(([index, isOpen]) => {
      if (isOpen) {
        const dropdown = dropdownRef.current
        if (dropdown) {
          const rect = dropdown.getBoundingClientRect()
          const buffer = 10 // small padding from edge
          // Check if it's going off the screen at the bottom
          if (rect.bottom > window.innerHeight) {
            dropdown.style.top = 'auto'
            dropdown.style.bottom = '100%' // position it above
            dropdown.style.marginTop = '0'
            dropdown.style.marginBottom = '4px'
          } else {
            dropdown.style.top = '100%' // position it below
            dropdown.style.bottom = 'auto'
            dropdown.style.marginTop = '4px'
            dropdown.style.marginBottom = '0'
          }
          // Optionally check horizontal overflow too
          if (rect.right > window.innerWidth - buffer) {
            dropdown.style.left = 'auto'
            dropdown.style.right = '0'
          }
        }
      }
    })
  }, [openDropdowns])
}
