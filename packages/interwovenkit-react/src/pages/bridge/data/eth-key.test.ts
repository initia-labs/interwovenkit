import { Secp256k1 } from "@cosmjs/crypto"
import { fromBase64, fromBech32, fromHex, toHex } from "@cosmjs/encoding"
import { AuthInfo, TxRaw } from "cosmjs-types/cosmos/tx/v1beta1/tx"
import {
  deriveCosmosAddress,
  isEthKeyChain,
  isPubkeyRequired,
  withInjectivePubkey,
} from "./eth-key"

// Public key of private key 0x01 (the secp256k1 generator point)
const PUBKEY = fromHex("0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798")
// Well-known Ethereum address of private key 0x01
const ETH_ADDRESS = "7e5f4552091a69125d5dfcb7b8c2659029395bdf"
// HASH160 of the compressed public key above (BIP173 test vector)
const SECP256K1_ADDRESS = "751e76e8199196d454941c45d1b3a323f1433bd6"

const noble = { chain_id: "noble-1", bech32_prefix: "noble" }
const injective = { chain_id: "injective-1", bech32_prefix: "inj" }

function decode(address: string) {
  const { prefix, data } = fromBech32(address)
  return { prefix, data: toHex(data) }
}

describe("isEthKeyChain", () => {
  it("matches Injective mainnet and testnet", () => {
    expect(isEthKeyChain("injective-1")).toBe(true)
    expect(isEthKeyChain("injective-888")).toBe(true)
  })

  it("rejects secp256k1 chains", () => {
    expect(isEthKeyChain("noble-1")).toBe(false)
    expect(isEthKeyChain("interwoven-1")).toBe(false)
  })
})

describe("deriveCosmosAddress", () => {
  it("reuses address bytes between secp256k1 chains", () => {
    const source = { ethKey: false, address: fromHex(SECP256K1_ADDRESS) }
    expect(decode(deriveCosmosAddress(noble, source))).toEqual({
      prefix: "noble",
      data: SECP256K1_ADDRESS,
    })
  })

  it("reuses address bytes between eth key chains", () => {
    const source = { ethKey: true, address: fromHex(ETH_ADDRESS) }
    expect(decode(deriveCosmosAddress(injective, source))).toEqual({
      prefix: "inj",
      data: ETH_ADDRESS,
    })
  })

  it("derives a secp256k1 address from an eth key source", () => {
    const source = { ethKey: true, address: fromHex(ETH_ADDRESS), pubkey: PUBKEY }
    expect(decode(deriveCosmosAddress(noble, source))).toEqual({
      prefix: "noble",
      data: SECP256K1_ADDRESS,
    })
  })

  it("derives an eth address from a secp256k1 source", () => {
    const source = { ethKey: false, address: fromHex(SECP256K1_ADDRESS), pubkey: PUBKEY }
    expect(decode(deriveCosmosAddress(injective, source))).toEqual({
      prefix: "inj",
      data: ETH_ADDRESS,
    })
  })

  it("matches an injective-1 account derived from its stored public key", () => {
    // From /cosmos/auth/v1beta1/accounts/inj1cml96vmptgw99syqrrz8az79xer2pcgp0a885r
    const pubkey = fromBase64("AtXCpR7zQkJ2tZ3oiKA3V9ugfBEkUUmw6dC1bQAX8f3v")
    const source = { ethKey: false, address: fromHex(SECP256K1_ADDRESS), pubkey }
    expect(deriveCosmosAddress(injective, source)).toBe(
      "inj1cml96vmptgw99syqrrz8az79xer2pcgp0a885r",
    )
  })

  it("accepts an uncompressed public key", () => {
    const pubkey = Secp256k1.uncompressPubkey(PUBKEY)
    const source = { ethKey: true, address: fromHex(ETH_ADDRESS), pubkey }
    expect(decode(deriveCosmosAddress(noble, source)).data).toBe(SECP256K1_ADDRESS)
  })

  it("throws when the key types differ and no public key is given", () => {
    const source = { ethKey: true, address: fromHex(ETH_ADDRESS) }
    expect(() => deriveCosmosAddress(noble, source)).toThrow("Pubkey not found")
  })
})

describe("isPubkeyRequired", () => {
  it("requires a public key when an intermediate chain uses the other key type", () => {
    expect(isPubkeyRequired(["injective-1", "noble-1"], true)).toBe(true)
    expect(isPubkeyRequired(["osmosis-1", "injective-1"], false)).toBe(true)
  })

  it("does not require a public key when every chain uses the source key type", () => {
    expect(isPubkeyRequired(["noble-1", "osmosis-1"], false)).toBe(false)
    expect(isPubkeyRequired(["injective-888"], true)).toBe(false)
    expect(isPubkeyRequired([], true)).toBe(false)
  })
})

describe("withInjectivePubkey", () => {
  const pubkeyValue = new Uint8Array([10, 33, ...PUBKEY])
  const authInfo = AuthInfo.fromPartial({
    signerInfos: [
      {
        publicKey: { typeUrl: "/cosmos.crypto.secp256k1.PubKey", value: pubkeyValue },
        modeInfo: { single: { mode: 127 } },
        sequence: 3n,
      },
    ],
    fee: { amount: [{ denom: "inj", amount: "100" }], gasLimit: 200000n },
  })
  const txRaw = TxRaw.fromPartial({
    bodyBytes: new Uint8Array([1, 2, 3]),
    authInfoBytes: AuthInfo.encode(authInfo).finish(),
    signatures: [new Uint8Array([4, 5, 6])],
  })

  it("replaces only the public key type", () => {
    const result = withInjectivePubkey(txRaw)
    const decoded = AuthInfo.decode(result.authInfoBytes)
    expect(decoded.signerInfos[0].publicKey).toEqual({
      typeUrl: "/injective.crypto.v1beta1.ethsecp256k1.PubKey",
      value: pubkeyValue,
    })
    expect(decoded.signerInfos[0].sequence).toBe(3n)
    expect(decoded.signerInfos[0].modeInfo?.single?.mode).toBe(127)
    expect(decoded.fee?.gasLimit).toBe(200000n)
    expect(decoded.fee?.amount).toEqual([{ denom: "inj", amount: "100" }])
    expect(result.bodyBytes).toEqual(new Uint8Array([1, 2, 3]))
    expect(result.signatures).toEqual([new Uint8Array([4, 5, 6])])
  })

  it("throws on a direct mode signature", () => {
    const direct = AuthInfo.fromPartial({
      signerInfos: [{ ...authInfo.signerInfos[0], modeInfo: { single: { mode: 1 } } }],
    })
    const directTxRaw = { ...txRaw, authInfoBytes: AuthInfo.encode(direct).finish() }
    expect(() => withInjectivePubkey(directTxRaw)).toThrow(
      "Injective transactions must be signed in amino mode",
    )
  })
})
