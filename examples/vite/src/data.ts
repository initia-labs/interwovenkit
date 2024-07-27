import { useEffect } from "react"
import { atom, useAtomValue } from "jotai"

export const isTestnet = import.meta.env.INITIA_NETWORK_TYPE === "testnet"
export const themeAtom = atom<"light" | "dark">("dark")
export function useTheme() {
  const theme = useAtomValue(themeAtom)
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme)
  }, [theme])
  return theme
}
