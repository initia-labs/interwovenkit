import { any, includes } from "ramda"

export function filterBySearch<T>(fields: Array<keyof T>, search: string, data: T[]): T[] {
  return data.filter((item) => {
    const values = fields.map((field) => item[field]).map((val) => String(val ?? "").toLowerCase())
    return any(includes(search.toLowerCase()), values)
  })
}
