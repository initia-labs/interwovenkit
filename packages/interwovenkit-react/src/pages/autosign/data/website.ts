export function isVerifiedWebsiteHost(registeredWebsite: string, currentHostname: string): boolean {
  try {
    const registeredHostname = new URL(registeredWebsite).hostname.toLowerCase()
    const current = currentHostname.toLowerCase()

    if (!registeredHostname || !current) return false

    return current === registeredHostname || current.endsWith(`.${registeredHostname}`)
  } catch {
    return false
  }
}
