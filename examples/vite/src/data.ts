import { useEffect } from "react"
import { atom, useAtomValue } from "jotai"
import { MAINNET, TESTNET } from "@initia/interwovenkit-react"

export const isTestnet = import.meta.env.INITIA_NETWORK_TYPE === "testnet"
export const chainId = isTestnet ? TESTNET.defaultChainId : MAINNET.defaultChainId
export const routerApiUrl = "https://router-api.staging.initia.xyz"
export const themeAtom = atom<"light" | "dark">("dark")
export function useTheme() {
  const theme = useAtomValue(themeAtom)
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme)
  }, [theme])
  return theme
}
