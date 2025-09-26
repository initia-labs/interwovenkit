export function groupByDate<T>(
  items: T[],
  getDate: (item: T) => Date | undefined,
): Record<string, T[]> {
  return items.reduce(
    (groups, item) => {
      const date = getDate(item)
      if (!date) return groups

      const dateKey = date.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      })

      const existingGroup = groups[dateKey] || []
      return {
        ...groups,
        [dateKey]: [...existingGroup, item],
      }
    },
    {} as Record<string, T[]>,
  )
}
