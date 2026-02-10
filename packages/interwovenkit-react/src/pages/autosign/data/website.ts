const GENERIC_SECOND_LEVEL_DOMAINS = new Set(["ac", "co", "com", "edu", "gov", "mil", "net", "org"])

function isIpv4(hostname: string): boolean {
  const parts = hostname.split(".")
  if (parts.length !== 4) return false

  return parts.every((part) => {
    if (!/^\d+$/.test(part)) return false
    const value = Number(part)
    return value >= 0 && value <= 255
  })
}

function isIpHostname(hostname: string): boolean {
  return isIpv4(hostname) || hostname.includes(":")
}

function isPublicSuffixLike(hostname: string): boolean {
  const parts = hostname.split(".")
  if (parts.length !== 2) return false

  const [sld, tld] = parts
  return tld.length === 2 && GENERIC_SECOND_LEVEL_DOMAINS.has(sld)
}

function isAllowedRegisteredHost(url: URL): boolean {
  if (url.protocol !== "https:") return false

  const hostname = url.hostname.toLowerCase()
  if (!hostname || !hostname.includes(".")) return false
  if (hostname === "localhost") return false
  if (isIpHostname(hostname)) return false
  if (isPublicSuffixLike(hostname)) return false

  return true
}

export function isVerifiedWebsiteHost(registeredWebsite: string, currentHostname: string): boolean {
  try {
    const parsed = new URL(registeredWebsite)
    if (!isAllowedRegisteredHost(parsed)) return false

    const registeredHostname = parsed.hostname.toLowerCase()
    const current = currentHostname.toLowerCase()

    if (!registeredHostname || !current) return false

    return current === registeredHostname || current.endsWith(`.${registeredHostname}`)
  } catch {
    return false
  }
}
