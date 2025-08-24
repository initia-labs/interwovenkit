import type { Coin } from "@interchainjs/cosmos-types"
import type { Event } from "@cosmjs/stargate"
import { createUserDerivedObjectAddress } from "@initia/utils"

interface MoveEventData {
  store_addr: string
  amount: string
  metadata_addr: string
}

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

export function getMoveChanges(
  events: Event[],
  hexAddress: string,
): { amount: string; metadata: string }[] {
  const changes: { [metadata: string]: bigint } = {}

  for (const event of events) {
    const hasMsgIndex = event.attributes.some((attr) => attr.key === "msg_index")
    if (!hasMsgIndex) {
      continue
    }

    if (event.type === "move") {
      const typeTag = event.attributes.find((attr) => attr.key === "type_tag")?.value
      const data = event.attributes.find((attr) => attr.key === "data")?.value

      if (!typeTag || !data) continue

      let parsedData: MoveEventData
      try {
        parsedData = JSON.parse(data)
      } catch {
        continue
      }

      if (typeTag === "0x1::fungible_asset::WithdrawEvent") {
        const store_addr = parsedData.store_addr
        const amount = parsedData.amount
        const metadata = parsedData.metadata_addr

        if (store_addr && amount && metadata) {
          const derivedAddr = createUserDerivedObjectAddress(hexAddress, metadata)
          if (derivedAddr === store_addr) {
            const current = changes[metadata] || BigInt(0)
            changes[metadata] = current - BigInt(amount)
          }
        }
      }

      if (typeTag === "0x1::fungible_asset::DepositEvent") {
        const store_addr = parsedData.store_addr
        const amount = parsedData.amount
        const metadata = parsedData.metadata_addr

        if (store_addr && amount && metadata) {
          const derivedAddr = createUserDerivedObjectAddress(hexAddress, metadata)
          if (derivedAddr === store_addr) {
            const current = changes[metadata] || BigInt(0)
            changes[metadata] = current + BigInt(amount)
          }
        }
      }
    }
  }

  return Object.entries(changes)
    .filter(([, amount]) => amount !== BigInt(0))
    .map(([metadata, amount]) => ({
      amount: amount.toString(),
      metadata,
    }))
}
