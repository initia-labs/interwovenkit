// /__mock/* control API: config, simulated-deposit listing/creation, manual
// advance, forced transitions, and reset. Isolated from the business prefix so
// its consumers (curl, AI test drivers) are never affected by delay/error
// injection.

import type { Context, Hono } from "hono"
import { normalizeWalletAddress } from "./bech32.ts"
import { clearCheckoutTimers } from "./checkout.ts"
import { validateConfigPatch } from "./config.ts"
import {
  advanceOneStep,
  applyTransition,
  clearAllTimers,
  InvalidTransitionError,
  registerDeposit,
  resyncAllTimers,
} from "./lifecycle.ts"
import { deriveDepositAddress, fetchAssets, UpstreamError } from "./proxy.ts"
import type { SimDeposit } from "./state.ts"
import {
  getConfig,
  getDeposit,
  listCheckouts,
  listDeposits,
  patchConfig,
  resetState,
} from "./state.ts"
import type { DepositStatus } from "./statusMachine.ts"
import { forcedTransitionMeta, parseDepositStatus } from "./statusMachine.ts"

interface CreateDepositBody {
  wallet_address?: unknown
  chain_id?: unknown
  asset_denom?: unknown
  amount?: unknown
  src_chain_id?: unknown
  src_denom?: unknown
  status?: unknown
}

const asTrimmedString = (value: unknown): string => (typeof value === "string" ? value.trim() : "")

async function handleCreateDeposit(c: Context): Promise<Response> {
  const body = (await c.req.json().catch(() => null)) as CreateDepositBody | null
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return c.json({ error: "invalid request body" }, 400)
  }

  const walletInput = asTrimmedString(body.wallet_address)
  const chainId = asTrimmedString(body.chain_id)
  const assetDenom = asTrimmedString(body.asset_denom)
  const amount = asTrimmedString(body.amount)
  if (!walletInput || !chainId || !assetDenom || !amount) {
    return c.json({ error: "wallet_address, chain_id, asset_denom, and amount are required" }, 400)
  }
  const walletAddress = normalizeWalletAddress(walletInput)
  if (!walletAddress) {
    return c.json({ error: "wallet_address must be a valid init bech32 or 0x EVM address" }, 400)
  }
  if (!/^\d+$/.test(amount) || BigInt(amount) <= 0n) {
    return c.json({ error: "amount must be a positive integer base-unit string" }, 400)
  }
  const status = body.status === undefined ? "detected" : body.status
  if (status !== "detected" && status !== "below_minimum") {
    return c.json({ error: "status must be detected or below_minimum" }, 400)
  }
  const srcChainId = asTrimmedString(body.src_chain_id)
  const srcDenom = asTrimmedString(body.src_denom)
  if ((srcChainId === "") !== (srcDenom === "")) {
    return c.json({ error: "src_chain_id and src_denom must be provided together" }, 400)
  }

  let depositAddress: string
  try {
    const mapping = await deriveDepositAddress(walletAddress, chainId, assetDenom)
    depositAddress = mapping.depositAddress
  } catch (error) {
    if (error instanceof UpstreamError) return c.json({ error: error.message }, error.status as 400)
    console.error("deposit address derivation failed", error)
    return c.json({ error: "failed to issue deposit address" }, 502)
  }

  // Resolve the source route: explicit src_* wins; otherwise the first asset
  // route that serves the destination (per the assets cache).
  let source = { srcChainId, srcDenom }
  let requiredMinAmount: string | undefined
  try {
    const assets = await fetchAssets()
    const matchesDestination = (asset: (typeof assets)[number]) =>
      asset.dst_networks.some(
        (network) =>
          network.chain_id === chainId && network.denom.toLowerCase() === assetDenom.toLowerCase(),
      )
    if (source.srcChainId === "") {
      const route = assets.find(matchesDestination)
      if (!route) return c.json({ error: "no source route found for the destination" }, 400)
      source = { srcChainId: route.src_chain_id, srcDenom: route.src_denom }
      requiredMinAmount = route.min_deposit_amount
    } else {
      requiredMinAmount = assets.find(
        (asset) =>
          asset.src_chain_id === source.srcChainId &&
          asset.src_denom.toLowerCase() === source.srcDenom.toLowerCase(),
      )?.min_deposit_amount
    }
  } catch (error) {
    if (source.srcChainId === "") {
      console.error("assets fetch failed", error)
      return c.json({ error: "failed to resolve a source route from upstream assets" }, 502)
    }
    // Explicit src_* provided: the route lookup was only for the minimum snapshot.
    console.warn("assets fetch failed; required_min_amount is unavailable", error)
  }

  // A below_minimum record without the route minimum would be self-contradictory
  // ("below minimum 0" — amount is always a positive integer), so fail instead.
  if (status === "below_minimum" && requiredMinAmount === undefined) {
    return c.json({ error: "failed to resolve required_min_amount for the source route" }, 502)
  }

  const sim = registerDeposit({
    depositAddress,
    walletAddress,
    dstChainId: chainId,
    dstDenom: assetDenom,
    srcChainId: source.srcChainId,
    srcDenom: source.srcDenom,
    amount,
    status,
    requiredMinAmount,
  })
  return c.json(sim.record, 201)
}

function findDepositOr404(c: Context): SimDeposit | Response {
  const sim = getDeposit(c.req.param("id") ?? "")
  return sim ?? c.json({ error: "deposit not found" }, 404)
}

export function registerControlRoutes(app: Hono): void {
  app.get("/__mock/config", (c) => c.json(getConfig()))

  app.patch("/__mock/config", async (c) => {
    const body = await c.req.json().catch(() => null)
    try {
      const patch = validateConfigPatch(body)
      const updated = patchConfig(patch)
      // A toggled autoAdvance or a new interval must reach existing timers.
      if ("autoAdvance" in patch || "advanceIntervalMs" in patch) resyncAllTimers()
      return c.json(updated)
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : "invalid config patch" }, 400)
    }
  })

  app.get("/__mock/deposits", (c) => {
    const deposits = listDeposits()
      .toSorted((a, b) => b.createdAtMs - a.createdAtMs)
      .map((sim) => sim.record)
    const checkouts = listCheckouts()
      .toSorted((a, b) => b.createdAtMs - a.createdAtMs)
      .map(({ transactionId, uuid, depositAddress, fiat, crypto, network, amount, paid }) => ({
        transaction_id: transactionId,
        uuid,
        deposit_address: depositAddress,
        fiat,
        crypto,
        network,
        amount,
        paid,
      }))
    return c.json({ deposits, checkouts })
  })

  app.post("/__mock/deposits", handleCreateDeposit)

  app.post("/__mock/deposits/:id/advance", async (c) => {
    const sim = findDepositOr404(c)
    if (sim instanceof Response) return sim
    try {
      await advanceOneStep(sim)
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : "advance failed" }, 400)
    }
    return c.json(sim.record)
  })

  app.post("/__mock/deposits/:id/status", async (c) => {
    const sim = findDepositOr404(c)
    if (sim instanceof Response) return sim
    const body = (await c.req.json().catch(() => null)) as { status?: unknown } | null
    const status = typeof body?.status === "string" ? parseDepositStatus(body.status) : null
    if (!status) return c.json({ error: "status is invalid" }, 400)
    try {
      const from = sim.record.status as DepositStatus
      await applyTransition(sim, status, forcedTransitionMeta(from, status))
    } catch (error) {
      if (error instanceof InvalidTransitionError) return c.json({ error: error.message }, 400)
      throw error
    }
    return c.json(sim.record)
  })

  app.post("/__mock/reset", (c) => {
    clearAllTimers()
    clearCheckoutTimers()
    resetState()
    return c.body(null, 204)
  })
}
