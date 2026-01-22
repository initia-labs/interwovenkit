import ky from "ky"

// ============================================
// CONSTANTS
// ============================================

/** SSE reconnection backoff settings (milliseconds) */
export const SSE_RECONNECT_BASE_DELAY = 1000
export const SSE_RECONNECT_MAX_DELAY = 10000

// ============================================
// CLIENT
// ============================================

export function createMinityClient(minityUrl?: string) {
  return ky.create({
    prefixUrl: minityUrl || "https://portfolio-api.minity.xyz",
    timeout: 30000, // 30 seconds timeout for portfolio API
  })
}
