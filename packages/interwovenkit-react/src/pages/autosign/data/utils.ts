import type { TxRequest } from "@/data/tx"

/**
 * Validates whether a transaction request can be automatically signed without user interaction.
 * Verifies that all message types in the request are authorized for auto-signing on the target chain.
 * Used to determine if a transaction should bypass the manual signing flow.
 */
export function canAutoSignHandleRequest(
  txRequest: TxRequest,
  autoSignPermissions?: Record<string, string[]>,
): boolean {
  if (!autoSignPermissions || !txRequest.chainId) {
    return false
  }

  const allowedMessageTypes = autoSignPermissions[txRequest.chainId]
  if (!allowedMessageTypes || allowedMessageTypes.length === 0) {
    return false
  }

  return txRequest.messages.every((message) => allowedMessageTypes.includes(message.typeUrl))
}

/**
 * Extracts metadata about the current web page for auto-sign registration.
 * Retrieves the page's favicon URL and title to identify the requesting application.
 * Validates icon URLs to ensure they are properly formatted before returning.
 */
export function getPageInfo() {
  const iconHref = (document.querySelector("link[rel~='icon']") as HTMLLinkElement | null)?.href

  const getValidIconUrl = (href: string | undefined): string | undefined => {
    if (!href) return undefined

    try {
      new URL(href)
      return href
    } catch {
      return undefined
    }
  }

  return {
    icon: getValidIconUrl(iconHref),
    name: document.title,
  }
}
