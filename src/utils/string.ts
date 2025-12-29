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

export function replaceSpecialCharsForQB(input: string) {
  // list of allowed characters in QB.
  // Doc: https://quickbooks.intuit.com/learn-support/en-us/help-article/account-management/acceptable-characters-quickbooks-online/L3CiHlD9J_US_en_US
  const allowedCharacters = [
    ',',
    '?',
    '@',
    '&',
    '!',
    // "'", even though included as allowed list in above docs, single quote is not allowed as this throws error.
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
