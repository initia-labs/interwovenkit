import ky from "ky"
import { useQuery } from "@tanstack/react-query"

export function useIsAccountCreated(restUrl: string, address: string) {
  return useQuery({
    queryKey: ["accountInfo", restUrl, address],
    queryFn: async () => {
      const rest = ky.create({ prefixUrl: restUrl })
      const path = `cosmos/auth/v1beta1/account_info/${address}`

      try {
        await rest.get(path).json()
        return true
      } catch {
        return false
      }
    },
    enabled: !!address && !!restUrl,
  })
}
