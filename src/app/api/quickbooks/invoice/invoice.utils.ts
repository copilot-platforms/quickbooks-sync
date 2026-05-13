export const formatAssemblyInvoicePrivateNote = (
  invoiceNumber: string,
): string => `Assembly invoice: ${invoiceNumber}`

const QBO_DOCNUMBER_MAX_LENGTH = 21
const MAX_SUFFIX_ATTEMPTS = 99

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
 * Recognizes QBO Error 6240 "Duplicate Document Number" across error shapes.
 *
 * The `.status`/`.code` branches are forward-compatible: today `intuitAPI.ts`
 * reads `Fault.Error?.code` as if it were an object (it's actually an array),
 * so APIError lands with status=400, not 6240. The live safety net is the
 * regex over `.message`. When the array-access is corrected the structured
 * branches will start firing too.
 */
export const isQBODuplicateDocNumberError = (err: unknown): boolean => {
  if (!err || typeof err !== 'object' || Array.isArray(err)) return false
  const e = err as {
    status?: string | number
    code?: string | number
    message?: string
  }
  if (e.status === 6240 || e.status === '6240') return true
  if (e.code === 6240 || e.code === '6240') return true
  const message = e.message ?? ''
  return /6240|Duplicate Document Number/i.test(message)
}
