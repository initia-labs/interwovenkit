import { fromBase64 } from "@cosmjs/encoding"
import { BinaryWriter } from "cosmjs-types/binary"
import { BaseAccount } from "cosmjs-types/cosmos/auth/v1beta1/auth"
import { PubKey } from "cosmjs-types/cosmos/crypto/secp256k1/keys"
import { parseAccount } from "./accounts"

// injective-1 account as returned by /cosmos/auth/v1beta1/accounts/{address}
const address = "inj1cml96vmptgw99syqrrz8az79xer2pcgp0a885r"
const key = fromBase64("AtXCpR7zQkJ2tZ3oiKA3V9ugfBEkUUmw6dC1bQAX8f3v")
const codeHash = fromBase64("xdJGAYb3IzySfn2y3McDwOUAtlPKgic7e/rYBF2FpHA=")

function encodeEthAccount(baseAccount: BaseAccount | null): Uint8Array {
  const writer = BinaryWriter.create()
  if (baseAccount) BaseAccount.encode(baseAccount, writer.uint32(10).fork()).ldelim()
  writer.uint32(18).bytes(codeHash)
  return writer.finish()
}

function makeBaseAccount(pubkeyTypeUrl?: string): BaseAccount {
  return BaseAccount.fromPartial({
    address,
    pubKey: pubkeyTypeUrl
      ? { typeUrl: pubkeyTypeUrl, value: PubKey.encode({ key }).finish() }
      : undefined,
    accountNumber: 7940n,
    sequence: 23n,
  })
}

describe("parseAccount", () => {
  it("parses an Injective EthAccount with an ethsecp256k1 public key", () => {
    const account = parseAccount({
      typeUrl: "/injective.types.v1beta1.EthAccount",
      value: encodeEthAccount(makeBaseAccount("/injective.crypto.v1beta1.ethsecp256k1.PubKey")),
    })

    expect(account).toEqual({
      address,
      pubkey: {
        type: "tendermint/PubKeySecp256k1",
        value: "AtXCpR7zQkJ2tZ3oiKA3V9ugfBEkUUmw6dC1bQAX8f3v",
      },
      accountNumber: 7940,
      sequence: 23,
    })
  })

  it("parses an Injective EthAccount that has not published a public key", () => {
    const account = parseAccount({
      typeUrl: "/injective.types.v1beta1.EthAccount",
      value: encodeEthAccount(makeBaseAccount()),
    })

    expect(account).toEqual({ address, pubkey: null, accountNumber: 7940, sequence: 23 })
  })

  it("throws when an EthAccount has no base account", () => {
    expect(() =>
      parseAccount({
        typeUrl: "/injective.types.v1beta1.EthAccount",
        value: encodeEthAccount(null),
      }),
    ).toThrow("EthAccount is missing base_account")
  })

  it("parses a BaseAccount with an Initia ethsecp256k1 public key", () => {
    const account = parseAccount({
      typeUrl: "/cosmos.auth.v1beta1.BaseAccount",
      value: BaseAccount.encode(
        makeBaseAccount("/initia.crypto.v1beta1.ethsecp256k1.PubKey"),
      ).finish(),
    })

    expect(account.pubkey).toEqual({
      type: "tendermint/PubKeySecp256k1",
      value: "AtXCpR7zQkJ2tZ3oiKA3V9ugfBEkUUmw6dC1bQAX8f3v",
    })
  })

  it("parses a BaseAccount with a Cosmos secp256k1 public key", () => {
    const account = parseAccount({
      typeUrl: "/cosmos.auth.v1beta1.BaseAccount",
      value: BaseAccount.encode(makeBaseAccount("/cosmos.crypto.secp256k1.PubKey")).finish(),
    })

    expect(account.pubkey).toEqual({
      type: "tendermint/PubKeySecp256k1",
      value: "AtXCpR7zQkJ2tZ3oiKA3V9ugfBEkUUmw6dC1bQAX8f3v",
    })
  })
})
