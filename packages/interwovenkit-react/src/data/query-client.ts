import type { QueryClient, QueryKey } from "@tanstack/react-query"

const INTERWOVENKIT_QUERY_KEY_PREFIX = "interwovenkit:"

function isInterwovenKitQueryKey(queryKey: QueryKey): boolean {
  const [namespace] = queryKey
  return typeof namespace === "string" && namespace.startsWith(INTERWOVENKIT_QUERY_KEY_PREFIX)
}

export function clearInterwovenKitQueries(queryClient: QueryClient) {
  queryClient.removeQueries({
    predicate: (query) => isInterwovenKitQueryKey(query.queryKey),
  })
}
