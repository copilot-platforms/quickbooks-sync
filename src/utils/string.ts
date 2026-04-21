export function excerpt(str: string, length: number) {
  if (str.length <= length) {
    return str
  }
  return str.slice(0, length) + '...'
}

/**
 * Replaces the text before "(number)" if it exists, otherwise replaces the whole string.
 * Handles both formats:
 *   - "<text> (number)" → replaces <text> only
 *   - "<text>" → replaces the entire string
 *
 * @param input - Original string
 * @param replacement - New text to use
 * @returns Updated string
 */
export function replaceBeforeParens(
  input: string,
  replacement: string,
): string {
  const match = input.match(/^(.*?)\s*\((\d+)\)\s*$/)
  if (match) {
    const number = match[2]
    return `${replacement} (${number})`
  } else {
    return replacement
  }
}

/**
 * Escapes single quotes for use in QBO query strings.
 * QBO query language uses backslash to escape single quotes: \\'
 */
export function escapeForQBQuery(input: string) {
  return input.replace(/'/g, "\\'")
}

const QBO_ITEM_NAME_LIMIT = 100
const ELLIPSIS = '...'

// Warning threshold is lower than the actual limit to account for
// suffixes like " (N)" that get appended server-side for duplicate names.
export const QBO_ITEM_NAME_MAX_LENGTH = 95

/**
 * Truncates a string to fit within QBO's item name limit (100 chars),
 * appending "..." to indicate truncation.
 * If a suffix is provided (e.g. " (2)"), the base name is truncated to
 * reserve room so the suffix is always preserved.
 */
export function truncateForQB(input: string, suffix?: string): string {
  if (!suffix) {
    if (input.length <= QBO_ITEM_NAME_LIMIT) {
      return input
    }
    return input.slice(0, QBO_ITEM_NAME_LIMIT - ELLIPSIS.length) + ELLIPSIS
  }

  const combined = input + suffix
  if (combined.length <= QBO_ITEM_NAME_LIMIT) {
    return combined
  }
  const maxBaseLength = Math.max(
    0,
    QBO_ITEM_NAME_LIMIT - suffix.length - ELLIPSIS.length,
  )
  return input.slice(0, maxBaseLength) + ELLIPSIS + suffix
}

const CUSTOMER_SUFFIX = ' (Customer)'

/**
 * Appends " (Customer)" to a DisplayName to disambiguate it from a colliding
 * Vendor/Employee. QBO enforces DisplayName uniqueness across those three
 * entities, so a Customer that shares a name with a Vendor needs a distinct
 * name. No-op if the suffix is already present.
 */
export function getNameAsCustomer(name: string): string {
  if (name.endsWith(CUSTOMER_SUFFIX)) {
    return name
  }
  return `${name}${CUSTOMER_SUFFIX}`
}

export function replaceSpecialCharsForQB(input: string) {
  // list of allowed characters in QB.
  // Doc: https://quickbooks.intuit.com/learn-support/en-us/help-article/account-management/acceptable-characters-quickbooks-online/L3CiHlD9J_US_en_US
  const allowedCharacters = [
    ',',
    '?',
    '@',
    '&',
    '!',
    "'",
    '*',
    '(',
    ')',
    '_',
    ';',
    '+',
    '#',
    '~',
    '.',
    '-',
    ' ',
  ]
  const a = allowedCharacters.map((c) => '\\' + c).join('')

  const regex = new RegExp(`[^a-zA-Z0-9${a}]+`, 'g') // regex allow alphabets, numbers and special characters
  return input.replace(regex, '-')
}
