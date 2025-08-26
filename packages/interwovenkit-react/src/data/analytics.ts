import { useCallback, useEffect } from "react"
import { useAccount } from "wagmi"
import * as amplitude from "@amplitude/analytics-browser"
import { Identify } from "@amplitude/analytics-browser"
import { usePath } from "@/lib/router"
import { useConfig } from "@/data/config"

const AMPLITUDE_API_KEY = ""

export function useAnalyticsInit() {
  const { disableAnalytics } = useConfig()

  useEffect(() => {
    if (disableAnalytics) return
    amplitude.init(AMPLITUDE_API_KEY)
  }, [disableAnalytics])
}

export function useAnalyticsIdentify() {
  const { connector } = useAccount()
  const { defaultChainId, disableAnalytics } = useConfig()

  useEffect(() => {
    if (disableAnalytics) return

    const identify = new Identify()

    if (connector?.name) {
      identify.set("connector", connector.name)
    }

    if (defaultChainId) {
      identify.set("defaultChainId", defaultChainId)
    }

    amplitude.identify(identify)
  }, [defaultChainId, connector?.name, disableAnalytics])
}

export function useAnalyticsTrack() {
  const path = usePath()
  const { disableAnalytics } = useConfig()

  const track = useCallback(
    (eventName: string, properties?: Record<string, unknown>) => {
      if (disableAnalytics) return

      amplitude.track(eventName, {
        path,
        ...properties,
      })
    },
    [path, disableAnalytics],
  )

  return track
}
