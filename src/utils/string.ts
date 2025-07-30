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
