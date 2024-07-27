import type { Options } from "ky"
import ky from "ky"
import { pathOr } from "ramda"

interface Pagination {
  next_key: string | null
  total: string
}

export type Paginated<K extends string, T> = { pagination: Pagination | null } & { [P in K]: T[] }

export function parsePaginatedResponse<K extends string, T>(
  key: K,
  data?: { pages: Array<Paginated<K, T>> },
) {
  const list: T[] = data?.pages?.map((page) => page[key] ?? []).flat() ?? []
  const count = pathOr(0, [0, "pagination", "total"], data?.pages)
  return { list, count }
}

export function getNextPageParam<K extends string, T>(data: Paginated<K, T>): string | null {
  return data.pagination?.next_key ?? null
}

export async function fetchAllPages<K extends string, T>(
  url: string,
  options: Options,
  key: K,
): Promise<T[]> {
  const instance = ky.create(options)
  const fetchPage = async (acc: T[], paginationKey: string | null): Promise<T[]> => {
    const response = await instance
      .extend(paginationKey ? { searchParams: { "pagination.key": paginationKey } } : {})
      .get(url)
      .json<Paginated<K, T>>()

    const items = response[key] ?? []
    const nextKey = getNextPageParam(response)
    const next = [...acc, ...items]
    return nextKey ? fetchPage(next, nextKey) : next
  }

  return fetchPage([], null)
}
