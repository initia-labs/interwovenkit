import { useEffect } from "react"
import { useAccount } from "wagmi"
import Amplitude from "."
import { usePath } from "../router"

export function useStartAmplitude() {
  /* start session and autotracking */
  useEffect(() => {
    Amplitude.start()
  }, [])

  /* track connected extension name */
  const { connector } = useAccount()
  useEffect(() => {
    if (connector?.name) {
      Amplitude.setUserWallet(connector.name)
    }
  }, [connector?.name])
}

export function useUpdateAmplitude() {
  /* track current path */
  const path = usePath()
  useEffect(() => {
    Amplitude.currentPath = path
  }, [path])
}
