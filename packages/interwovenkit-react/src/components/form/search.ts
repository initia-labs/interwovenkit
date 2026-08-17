export function filterBySearch<T>(fields: Array<keyof T>, search: string, data: T[]): T[] {
  const query = search.toLowerCase()
  return data.filter((item) =>
    fields.some((field) =>
      String(item[field] ?? "")
        .toLowerCase()
        .includes(query),
    ),
  )
}
