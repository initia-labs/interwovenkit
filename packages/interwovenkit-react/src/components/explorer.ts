import { path } from "ramda"
import xss from "xss"
import { InitiaAddress } from "@initia/utils"
import type { NormalizedChain } from "@/data/chains"

export function isValidTxHash(txHash: string): boolean {
  // Regex pattern for tx hash validation (64 hex characters)
  const TX_HASH_REGEX = /^[A-F0-9]{64}$/i
  return TX_HASH_REGEX.test(txHash)
}

export function buildExplorerUrl(
  chain: Pick<NormalizedChain, "explorers">,
  params: { txHash?: string; accountAddress?: string; pathSuffix?: string },
): string | undefined {
  const { txHash, accountAddress, pathSuffix } = params

  if (txHash) {
    if (!isValidTxHash(txHash)) return undefined
    const txPage = path<string>(["explorers", 0, "tx_page"], chain)
    return txPage?.replace(/\$\{txHash\}/g, txHash)
  }

  if (accountAddress) {
    if (!InitiaAddress.validate(accountAddress)) return undefined
    const accountPage = path<string>(["explorers", 0, "account_page"], chain)
    const baseUrl = accountPage?.replace(/\$\{accountAddress\}/g, accountAddress)
    return baseUrl && pathSuffix ? baseUrl + pathSuffix : baseUrl
  }

  return undefined
}

/** Scheme-checks and escapes an explorer link from an API response. */
export function safeExplorerUrl(href: string | undefined): string | undefined {
  return href ? xss(sanitizeLink(href)) : undefined
}

export function sanitizeLink(href: string): string {
  try {
    const url = new URL(href, window.location.href)
    if (!["http:", "https:"].includes(url.protocol)) {
      throw new Error("Invalid protocol")
    }
    return url.toString()
  } catch {
    return "#"
  }
}
