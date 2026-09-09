import { useEffect, useEffectEvent } from "react"
import { useAtomValue } from "jotai"
import { useConfig } from "@/data/config"
import { useDrawer, useModal } from "@/data/ui"
import { useInitiaAddress } from "@/public/data/hooks"
import { broadcastAutoSignEvent, subscribeAutoSignEvents, withAutoSignOperation } from "./lifecycle"
import { pendingAutoSignRequestAtom } from "./store"
import { useAutoSignStatus } from "./validation"

const PROMPT_PREFIX = "interwovenkit:autosign:reconnect:"
const shown = new Set<string>()

function wasShown(id: string) {
  if (shown.has(id)) return true
  try {
    return sessionStorage.getItem(PROMPT_PREFIX + id) === "shown"
  } catch {
    // Without session storage, keep recovery available through Settings.
    return true
  }
}

function markShown(id: string) {
  shown.add(id)
  try {
    sessionStorage.setItem(PROMPT_PREFIX + id, "shown")
  } catch {
    // The in-memory marker still prevents repeated prompts in this document.
  }
}

/** Opens only the widget. Wallet approval starts with the user's Reconnect action. */
export function useAutoSignReconnect() {
  const owner = useInitiaAddress()
  const { registryUrl, defaultChainId } = useConfig()
  const { data } = useAutoSignStatus()
  const { isDrawerOpen, openDrawer } = useDrawer()
  const { isModalOpen } = useModal()
  const pendingRequest = useAtomValue(pendingAutoSignRequestAtom)
  const openReconnect = useEffectEvent((chainId: string) => {
    if (!isDrawerOpen && !isModalOpen && !pendingRequest) {
      openDrawer("/autosign/reconnect", {
        chainId,
        durationInMs: data?.requestedDurationInMsByChain[chainId],
      })
    }
  })

  useEffect(() => {
    if (!owner) return
    return subscribeAutoSignEvents((event) => {
      if (event.owner !== owner || !event.id) return
      if (event.topic === "reconnect-shown") markShown(event.id)
      if (event.topic === "reconnect-query" && wasShown(event.id)) {
        broadcastAutoSignEvent({ topic: "reconnect-shown", owner, id: event.id })
      }
    })
  }, [owner])

  useEffect(() => {
    if (!owner || !data || isDrawerOpen || isModalOpen || pendingRequest) return
    // Auto-open only for the current integration's default chain, avoiding a
    // cascade of prompts from historical permissions on other networks.
    const chainId = defaultChainId
    const expiration = data.expiredAtByChain[chainId]
    const grantee = data.granteeByChain[chainId]
    if (
      data.statusByChain[chainId] !== "expired" ||
      !grantee ||
      !(expiration instanceof Date) ||
      expiration.getTime() > Date.now()
    )
      return

    const id = JSON.stringify([registryUrl, owner, chainId, grantee, expiration.toISOString()])
    if (wasShown(id)) return
    let cancelled = false
    void withAutoSignOperation(`reconnect:${owner}`, async () => {
      if (cancelled || wasShown(id)) return
      broadcastAutoSignEvent({ topic: "reconnect-query", owner, id })
      // Give an already-open tab a chance to share its session dismissal.
      await new Promise((resolve) => setTimeout(resolve, 100))
      if (cancelled || wasShown(id)) return
      markShown(id)
      broadcastAutoSignEvent({ topic: "reconnect-shown", owner, id })
      openReconnect(chainId)
    }).catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [owner, data, registryUrl, defaultChainId, isDrawerOpen, isModalOpen, pendingRequest])
}
