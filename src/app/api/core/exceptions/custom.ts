/**
 * Sometimes Intuit-SDK throws AxiosError. This custom helper function helps to identify the error.
 * @param error
 * @returns
 */
export function isAxiosError(
  error: unknown,
): error is { response: { status: number; data: any } } {
  return (
    typeof error === 'object' &&
    error !== null &&
    'response' in error &&
    typeof (error as any).response === 'object' &&
    'status' in (error as any).response
  )
}
