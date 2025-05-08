export const buildReturningFields = <T>(
  table: T,
  fields: (keyof T)[],
  bool: boolean = false,
) => {
  return fields.reduce(
    (acc, field) => {
      acc[field as string] = bool ? true : table[field]
      return acc
    },
    {} as Record<string, any>,
  )
}
