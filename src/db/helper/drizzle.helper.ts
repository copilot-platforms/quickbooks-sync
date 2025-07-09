export const buildReturningFields = <T>(
  table: T,
  fields: (keyof T)[],
  bool: boolean = false,
) => {
  return fields.reduce(
    (acc, field) => {
      acc[field as string] = bool || table[field]
      return acc
    },
    {} as Record<string, any>,
  )
}

export function enumToPgEnum<T extends Record<string, any>>(
  myEnum: T,
): [T[keyof T], ...T[keyof T][]] {
  return Object.values(myEnum).map((value: any) => `${value}`) as [
    T[keyof T],
    ...T[keyof T][],
  ]
}
