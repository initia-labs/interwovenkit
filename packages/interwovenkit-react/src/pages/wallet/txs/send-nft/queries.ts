import { createQueryKeys } from "@lukemorales/query-key-factory"

export const sendNftQueryKeys = createQueryKeys("interwovenkit:send-nft", {
  simulation: (params) => [params],
})
