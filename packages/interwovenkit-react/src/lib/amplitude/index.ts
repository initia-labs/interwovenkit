import { createInstance } from "@amplitude/analytics-browser"
import type { BrowserClient } from "@amplitude/analytics-browser/lib/esm/types"

const API_KEY = "3c75a073050e0510f6f5a303490a899f"

class Amplitude {
  private static instance: BrowserClient | null = null
  public static AMPLITUDE_CONTAINER_ID = "interwovenkit-container"

  public static start() {
    Amplitude.instance = createInstance()
    Amplitude.instance.init(API_KEY, {
      autocapture: {
        formInteractions: false,
        fileDownloads: false,
        elementInteractions: {
          cssSelectorAllowlist: [
            `#${Amplitude.AMPLITUDE_CONTAINER_ID} button`,
            `#${Amplitude.AMPLITUDE_CONTAINER_ID} a`,
            `#${Amplitude.AMPLITUDE_CONTAINER_ID} input`,
          ],
          actionClickAllowlist: [
            `#${Amplitude.AMPLITUDE_CONTAINER_ID} button`,
            `#${Amplitude.AMPLITUDE_CONTAINER_ID} a`,
            `#${Amplitude.AMPLITUDE_CONTAINER_ID} input`,
          ],
        },
      },
      serverZone: "EU",
    })
  }

  public static logEvent(event: string, properties?: Record<string, unknown>) {
    if (!Amplitude.instance) return

    Amplitude.instance.logEvent(`[Initia InterwovenKit] ${event}`, properties)
  }
}

export default Amplitude
