import type { Coin } from "cosmjs-types/cosmos/base/v1beta1/coin"
import type { Event } from "@cosmjs/stargate"

export function getCoinChanges(events: Event[], address: string): Coin[] {
  const changes: { [denom: string]: bigint } = {}

  for (const event of events) {
    const hasMsgIndex = event.attributes.some((attr) => attr.key === "msg_index")
    if (!hasMsgIndex) {
      continue
    }

    if (event.type === "coin_spent") {
      const spender = event.attributes.find((attr) => attr.key === "spender")?.value
      const amount = event.attributes.find((attr) => attr.key === "amount")?.value

      if (spender === address && amount) {
        const [amountStr, denom] = amount.match(/^(\d+)(.+)$/)?.slice(1) || []
        if (amountStr && denom) {
          const current = changes[denom] || BigInt(0)
          changes[denom] = current - BigInt(amountStr)
        }
      }
    }

    if (event.type === "coin_received") {
      const receiver = event.attributes.find((attr) => attr.key === "receiver")?.value
      const amount = event.attributes.find((attr) => attr.key === "amount")?.value

      if (receiver === address && amount) {
        const [amountStr, denom] = amount.match(/^(\d+)(.+)$/)?.slice(1) || []
        if (amountStr && denom) {
          const current = changes[denom] || BigInt(0)
          changes[denom] = current + BigInt(amountStr)
        }
      }
    }
  }

  return Object.entries(changes)
    .filter(([, amount]) => amount !== BigInt(0))
    .map(([denom, amount]) => ({
      amount: amount.toString(),
      denom,
    }))
}
