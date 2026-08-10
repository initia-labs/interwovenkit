/* eslint-disable no-console -- this is a console-driven debug tool; console output is the point. */
import type { QueryClient } from "@tanstack/react-query"

interface MockStratPositionOptions {
  /** Real xSLP denom on strat-1, confirmed via the Initia indexer asset list (symbol: "xSLP"). */
  denom?: string
  symbol?: string
  amount?: number
  protocol?: string
}

const REAL_XSLP_DENOM = "move/4e11c0a219f362e4d0e1f131699aa83bee40ebc8701b424373a8517d0c9e85fb"

interface MinimalSSEPortfolioData {
  balances: unknown[]
  positions: { chainName: string }[]
  isLoading: boolean
  isComplete: boolean
}

/**
 * DEBUG ONLY — injects a fake Strat vault position into the Minity SSE portfolio cache so the
 * xSLP pricing pipeline (fallback pricing + Strat supplemental price) can be exercised without a
 * real wallet holding a Strat position.
 *
 * Call from the browser console via `window.__mockStratPosition(...)`. Requires a wallet already
 * connected with the Portfolio tab opened once, so the real `ssePortfolio` query key exists.
 *
 * Note: only validates the pricing math for the `denom` you pass in — it can't confirm whether
 * Minity's real balance is xSLP or STRAT shares. Pass an unpriced `denom` (e.g. "ustrat") to see
 * the safe unpriced fallback instead.
 */
export function mockStratPosition(
  queryClient: QueryClient,
  options: MockStratPositionOptions = {},
) {
  const { denom = REAL_XSLP_DENOM, symbol = "xSLP", amount = 5, protocol = "Strat Vault" } = options

  const [query] = queryClient.getQueryCache().findAll({
    queryKey: ["interwovenkit:minity", "ssePortfolio"],
  })
  if (!query) {
    console.warn(
      "[mockStratPosition] No ssePortfolio query found yet — connect a wallet and open the Portfolio tab first.",
    )
    return
  }

  const key = query.queryKey
  const current = queryClient.getQueryData<MinimalSSEPortfolioData>(key) ?? {
    balances: [],
    positions: [],
    isLoading: false,
    isComplete: true,
  }

  const fakeStratChain = {
    chainName: "strat",
    chainId: "strat-1",
    positions: [
      {
        protocol,
        positions: [
          {
            type: "staking",
            balance: {
              type: "asset",
              denom,
              symbol,
              decimals: 6,
              amount: String(Math.round(amount * 1e6)),
              formattedAmount: amount,
              // no `value` — forces the fallback-pricing path (formattedAmount * price) to kick in
            },
          },
        ],
      },
    ],
  }

  queryClient.setQueryData(key, {
    ...current,
    positions: [...current.positions.filter((data) => data.chainName !== "strat"), fakeStratChain],
  })

  console.log(
    `[mockStratPosition] Injected ${amount} ${symbol} (denom: ${denom}) as a Strat vault position. Reopen the Portfolio tab to see it.`,
  )
}
