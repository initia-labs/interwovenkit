import type { Any } from "@interchainjs/cosmos-types"
import { CosmosCryptoSecp256k1PubKey } from "@interchainjs/cosmos-types"
import { BaseAccount } from "@interchainjs/cosmos-types"
import { encodeSecp256k1Pubkey, type Pubkey } from "@interchainjs/amino"
import { decodeOptionalPubkey } from "@interchainjs/pubkey"
import { Uint64 } from "@interchainjs/math"

export interface Account {
  /** Bech32 account address */
  readonly address: string
  readonly pubkey: Pubkey | null
  readonly accountNumber: number
  readonly sequence: number
}

function uint64FromProto(input: number | bigint): Uint64 {
  return Uint64.fromString(input.toString())
}

function accountFromBaseAccount(input: BaseAccount): Account {
  const { address, pubKey, accountNumber, sequence } = input
  const pubkey = decodeOptionalPubkey(pubKey)
  return {
    address: address,
    pubkey: pubkey,
    accountNumber: uint64FromProto(accountNumber).toNumber(),
    sequence: uint64FromProto(sequence).toNumber(),
  }
}

/**
 * Basic implementation of AccountParser. This is supposed to support the most relevant
 * common Cosmos SDK account types. If you need support for exotic account types,
 * you'll need to write your own account decoder.
 */
export function accountFromAny(input: Any): Account {
  const { typeUrl, value } = input

  switch (typeUrl) {
    // auth

    case "/cosmos.auth.v1beta1.BaseAccount":
      return accountFromBaseAccount(BaseAccount.decode(value))
    case "/cosmos.auth.v1beta1.ModuleAccount": {
      const baseAccount = ModuleAccount.decode(value).baseAccount
      assert(baseAccount)
      return accountFromBaseAccount(baseAccount)
    }

    // vesting

    case "/cosmos.vesting.v1beta1.BaseVestingAccount": {
      const baseAccount = BaseVestingAccount.decode(value)?.baseAccount
      assert(baseAccount)
      return accountFromBaseAccount(baseAccount)
    }
    case "/cosmos.vesting.v1beta1.ContinuousVestingAccount": {
      const baseAccount = ContinuousVestingAccount.decode(value)?.baseVestingAccount?.baseAccount
      assert(baseAccount)
      return accountFromBaseAccount(baseAccount)
    }
    case "/cosmos.vesting.v1beta1.DelayedVestingAccount": {
      const baseAccount = DelayedVestingAccount.decode(value)?.baseVestingAccount?.baseAccount
      assert(baseAccount)
      return accountFromBaseAccount(baseAccount)
    }
    case "/cosmos.vesting.v1beta1.PeriodicVestingAccount": {
      const baseAccount = PeriodicVestingAccount.decode(value)?.baseVestingAccount?.baseAccount
      assert(baseAccount)
      return accountFromBaseAccount(baseAccount)
    }

    default:
      throw new Error(`Unsupported type: '${typeUrl}'`)
  }
}

function decodeOptionalPubkeyInitia(pubkey: Any | null | undefined): Pubkey | null {
  if (pubkey?.typeUrl === "/initia.crypto.v1beta1.ethsecp256k1.PubKey") {
    const { key } = CosmosCryptoSecp256k1PubKey.decode(pubkey.value)
    return encodeSecp256k1Pubkey(key)
  }

  return decodeOptionalPubkey(pubkey)
}

export function parseAccount({ typeUrl, value }: Any): Account {
  if (typeUrl === "/cosmos.auth.v1beta1.BaseAccount") {
    const { address, pubKey, accountNumber, sequence } = BaseAccount.decode(value)
    const pubkey = decodeOptionalPubkeyInitia(pubKey)
    return { address, pubkey, accountNumber: Number(accountNumber), sequence: Number(sequence) }
  }

  return accountFromAny({ typeUrl, value })
}
