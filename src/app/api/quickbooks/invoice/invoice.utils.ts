export const formatAssemblyInvoicePrivateNote = (
  invoiceNumber: string,
): string => `Assembly invoice: ${invoiceNumber}`

const QBO_DOCNUMBER_MAX_LENGTH = 21
const MAX_SUFFIX_ATTEMPTS = 10

/**
 * Given the Assembly invoice number and a set of DocNumbers already taken in
 * the target QBO realm, return the next available DocNumber in the sequence
 * `<base>`, `<base>-1`, `<base>-2`, … Only exact-match candidates count as
 * "taken" — unrelated DocNumbers that merely share the base prefix (returned
 * over-broadly by QBO's LIKE query) are ignored.
 *
 * Throws if the candidate exceeds QBO's 21-char DocNumber limit, or if no
 * free slot is found within MAX_SUFFIX_ATTEMPTS iterations.
 */
export const findNextAvailableDocNumber = (
  base: string,
  taken: ReadonlySet<string>,
): string => {
  if (base.length > QBO_DOCNUMBER_MAX_LENGTH) {
    throw new Error(
      `DocNumber "${base}" exceeds 21 char limit; QBO will reject.`,
    )
  }
  if (!taken.has(base)) return base
  for (let n = 1; n <= MAX_SUFFIX_ATTEMPTS; n++) {
    const candidate = `${base}-${n}`
    if (candidate.length > QBO_DOCNUMBER_MAX_LENGTH) {
      throw new Error(
        `DocNumber "${candidate}" exceeds 21 char limit; cannot suffix further.`,
      )
    }
    if (!taken.has(candidate)) return candidate
  }
  throw new Error(
    `findNextAvailableDocNumber: no available DocNumber for "${base}" after ${MAX_SUFFIX_ATTEMPTS} attempts.`,
  )
}

/**
 * Recognizes QBO Error 6240 "Duplicate Document Number" across the shapes it
 * surfaces in.
 *
 * Live path: APIError thrown from intuitAPI._createInvoice carries the QBO
 * fault payload in its `errors` array (`{ code: '6240', Detail, Message }`).
 * APIError.status lands as 400 because intuitAPI dereferences
 * `Fault.Error?.code` as if it were an object (the QBO Fault.Error is an
 * array); APIError.message is the boilerplate `#IntuitAPIErrorMessage#…`.
 * So the only reliable signal is iterating `errors[]` and matching `code`
 * or the Detail/Message text.
 *
 * Defense-in-depth: also check top-level .status/.code/.message in case any
 * future call site rethrows the inner fault directly or normalizes the
 * APIError differently.
 */
export const isQBODuplicateDocNumberError = (err: unknown): boolean => {
  if (!err || typeof err !== 'object' || Array.isArray(err)) return false
  const e = err as {
    status?: string | number
    code?: string | number
    message?: string
    errors?: unknown
  }
  if (Array.isArray(e.errors)) {
    for (const item of e.errors) {
      if (!item || typeof item !== 'object') continue
      const fault = item as {
        code?: string | number
        Detail?: string
        Message?: string
      }
      if (fault.code === 6240 || fault.code === '6240') return true
      if (
        /6240|Duplicate Document Number/i.test(fault.Detail ?? '') ||
        /6240|Duplicate Document Number/i.test(fault.Message ?? '')
      ) {
        return true
      }
    }
  }
  if (e.status === 6240 || e.status === '6240') return true
  if (e.code === 6240 || e.code === '6240') return true
  return /6240|Duplicate Document Number/i.test(e.message ?? '')
}
