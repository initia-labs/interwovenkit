import * as v from "valibot"
import { InitiaAddress } from "@initia/utils"

export const RecipientSchema = v.pipe(
  v.string(),
  v.nonEmpty("Recipient address is required"),
  v.check((address) => InitiaAddress.validate(address), "Invalid address"),
)

/** Normalize the chain information from both Initia registry and Skip API */

export interface BaseChain {
  chainId: string
  name: string
  logoUrl: string
}

export interface BaseAsset {
  denom: string
  symbol: string
  decimals: number
  logoUrl: string
  name?: string
  balance?: string
  value?: number
}
