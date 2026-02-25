import { usePrefetchQuery } from "@tanstack/react-query"
import { STALE_TIMES } from "@/data/http"
import { skipQueryKeys, useSkip } from "./skip"

/** Prefetch chains and assets in parallel (no waterfall, no suspend) */
export function usePrefetchBridgeData() {
  const skip = useSkip()

  usePrefetchQuery({
    queryKey: skipQueryKeys.chains.queryKey,
    queryFn: () => skip.get("v2/info/chains").json(),
    staleTime: STALE_TIMES.MINUTE,
  })

  usePrefetchQuery({
    queryKey: skipQueryKeys.allAssets().queryKey,
    queryFn: () => skip.get("v2/fungible/assets").json(),
    staleTime: STALE_TIMES.MINUTE,
  })
}
