'use client'
import { useEffect, useId, useRef } from 'react'
import { createPortal } from 'react-dom'
import { Button } from 'copilot-design-system'

type ConfirmModalProps = {
  open: boolean
  title: string
  description: string
  confirmLabel?: string
  cancelLabel?: string
  onConfirm: () => void
  onCancel: () => void
}

export default function ConfirmModal({
  open,
  title,
  description,
  confirmLabel = 'Continue',
  cancelLabel = 'Cancel',
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  const titleId = useId()
  const descId = useId()
  const dialogRef = useRef<HTMLDivElement>(null)

  // On open, focus into the dialog; on close, restore focus to the opener.
  useEffect(() => {
    if (!open) return
    const previouslyFocused = document.activeElement as HTMLElement | null
    const buttons = dialogRef.current?.querySelectorAll<HTMLElement>('button')
    buttons?.[0]?.focus()
    return () => previouslyFocused?.focus()
  }, [open])

  // Escape cancels; Tab is trapped between the dialog's buttons.
  useEffect(() => {
    if (!open) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') return onCancel()
      if (e.key !== 'Tab') return
      const buttons = Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>('button') ?? [],
      )
      if (buttons.length === 0) return
      const first = buttons[0]
      const last = buttons[buttons.length - 1]
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open, onCancel])

  if (!open) return null

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={onCancel}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
        className="mx-4 w-full max-w-sm rounded-lg bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id={titleId} className="mb-2 text-base font-semibold">
          {title}
        </h2>
        <p id={descId} className="mb-6 text-sm text-gray-600">
          {description}
        </p>
        <div className="flex justify-end gap-2">
          <Button label={cancelLabel} variant="text" onClick={onCancel} />
          <Button label={confirmLabel} variant="primary" onClick={onConfirm} />
        </div>
      </div>
    </div>,
    document.body,
  )
}
