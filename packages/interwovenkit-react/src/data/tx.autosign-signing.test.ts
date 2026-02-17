import type { EncodeObject } from "@cosmjs/proto-signing"
import type { SigningStargateClient, StdFee } from "@cosmjs/stargate"
import type { TxRaw } from "cosmjs-types/cosmos/tx/v1beta1/tx"
import { describe, expect, it, vi } from "vitest"
import { signTxWithAutoSignFeeWithDeps } from "./tx"

const chainId = "initia-1"
const address = "init1granter"
const memo = "memo"
const messages: EncodeObject[] = [
  { typeUrl: "/cosmos.bank.v1beta1.MsgSend", value: { fromAddress: "a", toAddress: "b" } },
]
const fee: StdFee = {
  amount: [{ denom: "uinit", amount: "1000" }],
  gas: "200000",
}
const computedFee: StdFee = {
  amount: [{ denom: "uusdc", amount: "2500" }],
  gas: "250000",
}
const cachedDerivedWallet = {
  address: "init1derived",
  privateKey: new Uint8Array([9, 9, 9]),
  publicKey: new Uint8Array([1, 2, 3]),
}

const manualSignedTx = { signatures: [new Uint8Array([1])] } as unknown as TxRaw
const autoSignedTx = { signatures: [new Uint8Array([2])] } as unknown as TxRaw
const signingClient = {} as SigningStargateClient

const buildParams = (
  overrides: Partial<Parameters<typeof signTxWithAutoSignFeeWithDeps>[0]> = {},
): Parameters<typeof signTxWithAutoSignFeeWithDeps>[0] => ({
  address,
  chainId,
  messages,
  memo,
  fee,
  ...overrides,
})

const createDeps = (
  overrides: Partial<Parameters<typeof signTxWithAutoSignFeeWithDeps>[1]> = {},
): Parameters<typeof signTxWithAutoSignFeeWithDeps>[1] => ({
  validateAutoSign: vi.fn().mockReturnValue(true),
  getWallet: vi.fn().mockReturnValue(cachedDerivedWallet),
  deriveWallet: vi.fn().mockResolvedValue(cachedDerivedWallet),
  getSigningClient: vi.fn().mockResolvedValue(signingClient),
  computeAutoSignFee: vi.fn().mockResolvedValue(computedFee),
  signWithDerivedWallet: vi.fn().mockResolvedValue(autoSignedTx),
  signWithEthSecp256k1: vi.fn().mockResolvedValue(manualSignedTx),
  onAutoSignFallback: vi.fn(),
  ...overrides,
})

describe("signTxWithAutoSignFeeWithDeps", () => {
  it("falls back to manual signing when auto-sign fee computation fails", async () => {
    const deps = createDeps({
      computeAutoSignFee: vi.fn().mockRejectedValue(new Error("simulate failed")),
    })

    const result = await signTxWithAutoSignFeeWithDeps(buildParams(), deps)

    expect(result).toBe(manualSignedTx)
    expect(deps.signWithEthSecp256k1).toHaveBeenCalledWith(chainId, address, messages, fee, memo)
    expect(deps.signWithDerivedWallet).not.toHaveBeenCalled()
    expect(deps.onAutoSignFallback).toHaveBeenCalledWith({
      chainId,
      reason: "fee_computation_failed",
      errorMessage: "simulate failed",
    })
  })

  it("falls back to manual signing when derived wallet signing fails", async () => {
    const deps = createDeps({
      signWithDerivedWallet: vi.fn().mockRejectedValue(new Error("account not found")),
    })

    const result = await signTxWithAutoSignFeeWithDeps(buildParams(), deps)

    expect(result).toBe(manualSignedTx)
    expect(deps.signWithDerivedWallet).toHaveBeenCalledTimes(1)
    expect(deps.signWithEthSecp256k1).toHaveBeenCalledWith(chainId, address, messages, fee, memo)
    expect(deps.onAutoSignFallback).toHaveBeenCalledWith({
      chainId,
      reason: "derived_wallet_sign_failed",
      errorMessage: "account not found",
    })
  })

  it("does not derive wallet for programmatic flow when derivation is disabled", async () => {
    const deps = createDeps({
      getWallet: vi.fn().mockReturnValue(undefined),
    })

    const result = await signTxWithAutoSignFeeWithDeps(
      buildParams({ allowWalletDerivation: false }),
      deps,
    )

    expect(result).toBe(manualSignedTx)
    expect(deps.deriveWallet).not.toHaveBeenCalled()
    expect(deps.signWithEthSecp256k1).toHaveBeenCalledTimes(1)
    expect(deps.signWithDerivedWallet).not.toHaveBeenCalled()
    expect(deps.onAutoSignFallback).toHaveBeenCalledWith({
      chainId,
      reason: "missing_derived_wallet",
      errorMessage: undefined,
    })
  })

  it("falls back to manual signing when auto-sign validation fails", async () => {
    const deps = createDeps({
      validateAutoSign: vi.fn().mockReturnValue(false),
    })

    const result = await signTxWithAutoSignFeeWithDeps(buildParams(), deps)

    expect(result).toBe(manualSignedTx)
    expect(deps.signWithEthSecp256k1).toHaveBeenCalledWith(chainId, address, messages, fee, memo)
    expect(deps.onAutoSignFallback).toHaveBeenCalledWith({
      chainId,
      reason: "validation_failed",
      errorMessage: undefined,
    })
  })

  it("uses simulated auto-sign fee path when UI allows derivation", async () => {
    const deps = createDeps({
      getWallet: vi.fn().mockReturnValue(undefined),
      deriveWallet: vi.fn().mockResolvedValue(cachedDerivedWallet),
    })

    const result = await signTxWithAutoSignFeeWithDeps(
      buildParams({
        preferredFeeDenom: "uusdc",
        allowAutoSign: true,
        allowWalletDerivation: true,
      }),
      deps,
    )

    expect(result).toBe(autoSignedTx)
    expect(deps.deriveWallet).toHaveBeenCalledWith(chainId)
    expect(deps.getSigningClient).toHaveBeenCalledWith(chainId)
    expect(deps.computeAutoSignFee).toHaveBeenCalledWith({
      chainId,
      messages,
      memo,
      derivedWallet: cachedDerivedWallet,
      preferredFeeDenom: "uusdc",
      fallbackFeeDenom: "uinit",
      client: signingClient,
    })
    expect(deps.signWithDerivedWallet).toHaveBeenCalledWith(
      chainId,
      address,
      messages,
      computedFee,
      memo,
      cachedDerivedWallet,
    )
    expect(deps.signWithEthSecp256k1).not.toHaveBeenCalled()
  })

  it("uses manual signing when auto-sign is disabled for internal requests", async () => {
    const deps = createDeps()

    const result = await signTxWithAutoSignFeeWithDeps(buildParams({ allowAutoSign: false }), deps)

    expect(result).toBe(manualSignedTx)
    expect(deps.validateAutoSign).not.toHaveBeenCalled()
    expect(deps.deriveWallet).not.toHaveBeenCalled()
    expect(deps.computeAutoSignFee).not.toHaveBeenCalled()
    expect(deps.signWithDerivedWallet).not.toHaveBeenCalled()
    expect(deps.signWithEthSecp256k1).toHaveBeenCalledWith(chainId, address, messages, fee, memo)
    expect(deps.onAutoSignFallback).not.toHaveBeenCalled()
  })

  it("propagates user rejection when derivation is cancelled", async () => {
    const userRejectedError = new Error("User rejected the request")
    const deps = createDeps({
      getWallet: vi.fn().mockReturnValue(undefined),
      deriveWallet: vi.fn().mockRejectedValue(userRejectedError),
    })

    await expect(
      signTxWithAutoSignFeeWithDeps(
        buildParams({ allowAutoSign: true, allowWalletDerivation: true }),
        deps,
      ),
    ).rejects.toThrow(userRejectedError)

    expect(deps.signWithEthSecp256k1).not.toHaveBeenCalled()
    expect(deps.signWithDerivedWallet).not.toHaveBeenCalled()
    expect(deps.onAutoSignFallback).not.toHaveBeenCalled()
  })

  it("falls back to manual signing when derivation fails for non-user errors", async () => {
    const deps = createDeps({
      getWallet: vi.fn().mockReturnValue(undefined),
      deriveWallet: vi.fn().mockRejectedValue(new Error("wallet not available")),
    })

    const result = await signTxWithAutoSignFeeWithDeps(
      buildParams({ allowAutoSign: true, allowWalletDerivation: true }),
      deps,
    )

    expect(result).toBe(manualSignedTx)
    expect(deps.signWithEthSecp256k1).toHaveBeenCalledWith(chainId, address, messages, fee, memo)
    expect(deps.onAutoSignFallback).toHaveBeenCalledWith({
      chainId,
      reason: "derive_wallet_failed",
      errorMessage: "wallet not available",
    })
    expect(deps.onAutoSignFallback).toHaveBeenCalledTimes(1)
  })
})
