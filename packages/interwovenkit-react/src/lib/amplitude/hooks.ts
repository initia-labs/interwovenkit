import { useEffect, useRef, useState } from "react"
import { useAccount } from "wagmi"
import Amplitude from "."
import { usePath } from "../router"
import type { AmplitudeEvent } from "./types"

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

export function useAmplitudeDelayedLog(event?: AmplitudeEvent) {
  const [active, setActive] = useState(false)
  const timerRef = useRef<NodeJS.Timeout | null>(null)

  /* track amplitude hover event */
  useEffect(() => {
    if (active && event) {
      timerRef.current = setTimeout(() => {
        Amplitude.logEvent(event.name, {
          type: "hover",
          ...event.details,
        })
      }, 200)
    } else {
      if (timerRef.current) {
        clearTimeout(timerRef.current)
        timerRef.current = null
      }
    }

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current)
      }
    }
  }, [active, event])

  return setActive
}
