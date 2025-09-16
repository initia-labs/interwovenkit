import { useCallback, useEffect } from "react"
import { useAccount } from "wagmi"
import * as amplitude from "@amplitude/analytics-browser"
import { Identify } from "@amplitude/analytics-browser"
import { usePath } from "@/lib/router"
import { useConfig } from "@/data/config"

const AMPLITUDE_API_KEY = "c33b940c24c17e95f7d9d525d508ac61"

export function useAnalyticsInit() {
  const { disableAnalytics } = useConfig()

  useEffect(() => {
    if (!AMPLITUDE_API_KEY) return
    if (disableAnalytics) return
    amplitude.init(AMPLITUDE_API_KEY, { autocapture: false })
  }, [disableAnalytics])
}

export function useAnalyticsIdentify() {
  const { connector } = useAccount()
  const { defaultChainId, disableAnalytics } = useConfig()

  useEffect(() => {
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

  const track = useCallback(
    (eventName: string, properties?: Record<string, unknown>) => {
      amplitude.track(eventName, {
        path,
        ...properties,
      })
    },
    [path],
  )

  return track
}
