import { AutoSignCancelledError, getAutoSignPreference } from "./storage"

export { AutoSignCancelledError }

const ownerOperations = new Map<string, Promise<void>>()
const CHANNEL_NAME = "interwovenkit-autosign"

export interface AutoSignCoordinationEvent {
  topic: string
  owner: string
  id?: string
  revision?: number
  /** Internal public coordination marker. It never identifies a wallet or key. */
  sourceId?: string
}

// BroadcastChannel does not deliver a message to the sending channel object, but a
// short-lived sender is distinct from this module's subscribed channel. A stable
// document-scoped marker lets subscribers identify those local deliveries.
const sourceId =
  globalThis.crypto?.randomUUID?.() ??
  `autosign-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`

function getChannel() {
  if (typeof BroadcastChannel === "undefined") return undefined
  return new BroadcastChannel(CHANNEL_NAME)
}

/** Coordinates public lifecycle state only. Never put signer material in these events. */
export function broadcastAutoSignEvent(event: AutoSignCoordinationEvent) {
  const channel = getChannel()
  if (!channel) return
  channel.postMessage({ ...event, sourceId })
  channel.close()
}

export function subscribeAutoSignEvents(
  handler: (event: AutoSignCoordinationEvent, isLocal: boolean) => void,
) {
  const channel = getChannel()
  if (!channel) return () => undefined
  channel.onmessage = ({ data }) => {
    if (
      data &&
      typeof data.topic === "string" &&
      typeof data.owner === "string" &&
      (data.id === undefined || typeof data.id === "string") &&
      (data.revision === undefined || typeof data.revision === "number") &&
      (data.sourceId === undefined || typeof data.sourceId === "string")
    ) {
      handler(data, data.sourceId === sourceId)
    }
  }
  return () => channel.close()
}

/** Serializes local lifecycle writes for one owner. Durable revisions fence other tabs. */
export async function withAutoSignOperation<T>(
  owner: string,
  operation: () => Promise<T>,
): Promise<T> {
  const previous = ownerOperations.get(owner) ?? Promise.resolve()
  let release!: () => void
  const current = new Promise<void>((resolve) => {
    release = resolve
  })
  const queued = previous.then(() => current)
  ownerOperations.set(owner, queued)
  await previous
  try {
    if (typeof navigator !== "undefined" && navigator.locks) {
      return await navigator.locks.request(
        `interwovenkit-autosign:${owner}`,
        { mode: "exclusive" },
        operation,
      )
    }
    return await operation()
  } finally {
    release()
    if (ownerOperations.get(owner) === queued) ownerOperations.delete(owner)
  }
}

export async function assertAutoSignRevision(params: {
  owner: string
  origin: string
  revision: number
}): Promise<void> {
  const preference = await getAutoSignPreference(params.owner, params.origin)
  if (preference.revision !== params.revision) {
    throw new AutoSignCancelledError()
  }
}
