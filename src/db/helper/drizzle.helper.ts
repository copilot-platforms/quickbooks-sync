export const buildReturningFields = <T>(table: T, fields: (keyof T)[]) => {
  return fields.reduce(
    (acc, field) => {
      acc[field as string] = table[field]
      return acc
    },
    {} as Record<string, any>,
  )
}
