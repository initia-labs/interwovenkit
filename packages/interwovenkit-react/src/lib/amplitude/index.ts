import { createInstance } from "@amplitude/analytics-browser"
import type { BrowserClient } from "@amplitude/analytics-browser/lib/esm/types"

const API_KEY = "3c75a073050e0510f6f5a303490a899f"

class Amplitude {
  private static instance: BrowserClient | null = null
  public static currentPath: string | null = null
  public static AMPLITUDE_CONTAINER_ID = "interwovenkit-container"

  public static start() {
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
      execute: async (event) => {
        event.event_properties = {
          path: Amplitude.currentPath,
          ...event.event_properties,
        }
        return event
      },
    })
  }

  public static logEvent(event: string, properties?: Record<string, unknown>) {
    if (!Amplitude.instance) return

    Amplitude.instance.logEvent(`[Initia InterwovenKit] ${event}`, properties)
  }
}

export default Amplitude
