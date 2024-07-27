import { useEffect } from "react"
import { useConfig } from "@/data/config"

// A dedicated host element ensures the widget's Shadow DOM stays isolated even
// if multiple instances are rendered.
const ELEMENT_TAG = "interwoven-kit"

// Create or fetch the Shadow DOM root used by the widget. The Shadow DOM keeps
// our styles from leaking out to the host page.
function getShadowRoot() {
  const host =
    document.querySelector(ELEMENT_TAG) ||
    document.body.appendChild(document.createElement(ELEMENT_TAG))

  return host.shadowRoot || host.attachShadow({ mode: "open" })
}

// Portal container for rendering Drawer components.
// If container is provided, use it instead of the shadow root.
export function usePortalContainer() {
  const { theme, container } = useConfig()

  useEffect(() => {
    const host = document.querySelector<HTMLElement>(ELEMENT_TAG)
    host?.setAttribute("data-theme", theme)
  }, [theme])

  return container ?? getShadowRoot()
}

// Utility to let users manually append the provided stylesheet to the shadow root.
// The stylesheet is shipped as a CSS file, but users are expected to load it as text.
// Note: Since this function uses `document`, SSR users should handle it accordingly.
export function injectStyles(css: string) {
  const shadowRoot = getShadowRoot()
  const style = document.createElement("style")
  style.textContent = css
  shadowRoot.appendChild(style)
}
