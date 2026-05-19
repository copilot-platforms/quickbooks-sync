import { QBOErrorCodes } from '@/constant/intuitErrorCode'

export const formatAssemblyInvoicePrivateNote = (
  invoiceNumber: string,
): string => `Assembly invoice: ${invoiceNumber}`

const QBO_DOCNUMBER_MAX_LENGTH = 21
export const MAX_SUFFIX_ATTEMPTS = 10

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

const DUP_DOC_NUMBER_CODE = QBOErrorCodes.DUPLICATE_DOC_NUMBER
const DUP_DOC_NUMBER_CODE_STR = String(DUP_DOC_NUMBER_CODE)
const DUP_DOC_NUMBER_PATTERN = new RegExp(
  `${DUP_DOC_NUMBER_CODE}|Duplicate Document Number`,
  'i', // case insensitive
)

/**
 * Recognizes QBO's Duplicate Document Number error. Reads `.status`,
 * `.code`, `errors[].code`, and message text so it works whether the caller
 * surfaces the parsed APIError directly or wraps/normalises it.
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
      if (
        fault.code === DUP_DOC_NUMBER_CODE ||
        fault.code === DUP_DOC_NUMBER_CODE_STR
      ) {
        return true
      }
      if (
        DUP_DOC_NUMBER_PATTERN.test(fault.Detail ?? '') ||
        DUP_DOC_NUMBER_PATTERN.test(fault.Message ?? '')
      ) {
        return true
      }
    }
  }
  if (e.status === DUP_DOC_NUMBER_CODE || e.status === DUP_DOC_NUMBER_CODE_STR)
    return true
  if (e.code === DUP_DOC_NUMBER_CODE || e.code === DUP_DOC_NUMBER_CODE_STR)
    return true
  return DUP_DOC_NUMBER_PATTERN.test(e.message ?? '')
}
