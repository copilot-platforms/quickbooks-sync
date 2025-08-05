import { useEffect } from 'react'

export default function useClickOutside(
  ref: React.RefObject<HTMLElement | null>,
  handler: () => void,
  excludeRefs: React.RefObject<HTMLElement | null>[] = [],
) {
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      event.stopPropagation()
      const target = event.target as Node

      // Check if click is outside the main ref
      if (ref.current && !ref.current.contains(target)) {
        // Check if click is on any excluded elements
        const isExcluded = excludeRefs.some((excludeRef) => {
          return excludeRef.current && excludeRef.current.contains(target)
        })

        // Only call handler if not clicking on excluded elements
        if (!isExcluded) {
          handler()
        }
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [ref, handler, excludeRefs])
}
