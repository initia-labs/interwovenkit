import { createInstance, Identify } from "@amplitude/analytics-browser"
import type { BrowserClient } from "@amplitude/analytics-browser/lib/esm/types"

const API_KEY = "3c75a073050e0510f6f5a303490a899f"

class Amplitude {
  private static instance: BrowserClient | null = null
  public static currentPath: string | null = null
  public static AMPLITUDE_CONTAINER_ID = "interwovenkit-container"

  public static start() {
    if (Amplitude.instance) return

    Amplitude.instance = createInstance()
    Amplitude.instance.init(API_KEY, {
      autocapture: {
        formInteractions: false,
        fileDownloads: false,
        elementInteractions: {
          cssSelectorAllowlist: [`#${Amplitude.AMPLITUDE_CONTAINER_ID} [data-amp-track-name]`],
          actionClickAllowlist: [`#${Amplitude.AMPLITUDE_CONTAINER_ID} [data-amp-track-name]`],
        },
      },
      serverZone: "EU",
    })
    Amplitude.instance.add({
      name: "interwovenkit",
      execute: async (event) => {
        if (event.event_type === "[Amplitude] Element Clicked") {
          const { name, ...attributes } = event.event_properties!["[Amplitude] Element Attributes"]
          return {
            ...event,
            event_type: `[Initia] ${name}`,
            event_properties: {
              ...attributes,
              path: Amplitude.currentPath,
              type: "click",
            },
          }
        }

        event.event_properties = {
          path: Amplitude.currentPath,
          ...event.event_properties,
        }
        return event
      },
    })
  }

  public static setUserWallet(walletName: string) {
    const identify = new Identify().set("walletName", walletName)
    Amplitude.instance?.identify(identify)
  }

  public static logEvent(event: string, properties?: Record<string, unknown>) {
    if (!Amplitude.instance) return

    Amplitude.instance.logEvent(`[Initia] ${event}`, properties)
  }
}

export default Amplitude
