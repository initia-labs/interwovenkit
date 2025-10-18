import type { TxRequest } from "@/data/tx"

/**
 * Checks if all messages in a transaction request can be handled by the ghost wallet
 * based on the configured permissions for the specific chain.
 *
 * @param txRequest The transaction request to check
 * @param ghostWalletPermissions The configured permissions mapping chain IDs to allowed message types
 * @returns true if all messages can be handled, false otherwise
 */
export function canGhostWalletHandleTxRequest(
  txRequest: TxRequest,
  ghostWalletPermissions?: Record<string, string[]>,
): boolean {
  if (!ghostWalletPermissions || !txRequest.chainId) {
    return false
  }

  const allowedMessageTypes = ghostWalletPermissions[txRequest.chainId]
  if (!allowedMessageTypes || allowedMessageTypes.length === 0) {
    return false
  }

  return txRequest.messages.every((message) => allowedMessageTypes.includes(message.typeUrl))
}

/**
 * Gets the current page information including icon and name
 * @returns Object containing the page's icon URL and name
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
