import type { EncodeObject } from "@cosmjs/proto-signing"
import type { DeliverTxResponse, SigningStargateClient } from "@cosmjs/stargate"
import { TxRaw } from "cosmjs-types/cosmos/tx/v1beta1/tx"
import type { Any } from "cosmjs-types/google/protobuf/any"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  closeDrawer: vi.fn(),
  closeModal: vi.fn(),
  createSigningClient: vi.fn(),
  invalidateAccountSequence: vi.fn(),
  manualSign: vi.fn(),
  navigate: vi.fn(),
  openDrawer: vi.fn(),
  openModal: vi.fn(),
  requestHandler: undefined as
    | {
        txRequest: {
          messages: EncodeObject[]
          gas: number
          gasPrices: Array<{ denom: string; amount: string }> | null
          spendCoins: Array<{ denom: string; amount: string }>
        }
        resolve: (signedTx: TxRaw) => Promise<void>
        reject: (error: Error) => void
      }
    | undefined,
  validateAutoSign: vi.fn(),
}))

vi.mock("jotai", async (importOriginal) => ({
  ...((await importOriginal()) as object),
  useAtomValue: vi.fn(),
  useSetAtom: () => (value: typeof mocks.requestHandler) => {
    if (value && "txRequest" in value) mocks.requestHandler = value
  },
  useStore: () => ({ get: () => 0 }),
}))

vi.mock("usehooks-ts", () => ({ useEventCallback: (callback: unknown) => callback }))
vi.mock("@/lib/router", () => ({ useNavigate: () => mocks.navigate }))
vi.mock("@/pages/autosign/data/unlock-request", () => ({
  useRequestAutoSignUnlock: () => vi.fn(),
}))
vi.mock("@/pages/autosign/data/validation", () => ({
  isFeegrantEligibleForAutoSign: vi.fn(),
  useAutoSignStatus: () => ({ data: undefined }),
  useValidateAutoSign: () => mocks.validateAutoSign,
}))
vi.mock("@/pages/autosign/data/wallet", () => ({
  buildAuthzExecMessages: vi.fn(),
  signWithDerivedWalletWithPrivateKey: vi.fn(),
  useDeriveWallet: () => ({
    getWallet: vi.fn(),
    restoreWallet: vi.fn(),
    getWalletPrivateKey: vi.fn(),
    getWalletRevision: vi.fn(),
    assertWalletRevision: vi.fn(),
    clearWallet: vi.fn(),
  }),
}))
vi.mock("@/public/app/ModalContext", () => ({
  useModal: () => ({ openModal: mocks.openModal, closeModal: mocks.closeModal }),
}))
vi.mock("@/public/data/hooks", () => ({ useInitiaAddress: () => "init1owner" }))
vi.mock("./analytics", () => ({ useAnalyticsTrack: () => vi.fn() }))
vi.mock("./chains", () => ({
  useFindChain: () => () => ({ chain_name: "initia", metadata: { is_l1: true } }),
}))
vi.mock("./config", () => ({
  useConfig: () => ({ defaultChainId: "initia-1", registryUrl: "https://registry.example" }),
}))
vi.mock("./fee", () => ({ fetchGasPrices: vi.fn() }))
vi.mock("./http", () => ({ normalizeError: (error: Error) => Promise.resolve(error) }))
vi.mock("./signer", () => ({
  resolveSignerAccountSequence: vi.fn(),
  useCreateComet38Client: () => vi.fn(),
  useCreateSigningStargateClient: () => mocks.createSigningClient,
  useInvalidateAccountSequence: () => mocks.invalidateAccountSequence,
  useOfflineSigner: () => ({ getAccounts: vi.fn() }),
  useRegistry: () => ({
    encodeAsAny: (message: EncodeObject): Any => {
      const value = message.value as { amount: bigint; bytes: Uint8Array }
      return {
        typeUrl: message.typeUrl,
        value: new Uint8Array([Number(value.amount), ...value.bytes]),
      }
    },
    decode: (message: Any) => ({
      amount: BigInt(message.value[0]!),
      bytes: message.value.slice(1),
    }),
  }),
  useSignWithEthSecp256k1: () => mocks.manualSign,
}))
vi.mock("./ui", () => ({
  useDrawer: () => ({ openDrawer: mocks.openDrawer, closeDrawer: mocks.closeDrawer }),
}))

import { isTxNotBroadcast, MoveError } from "./errors"
import { useTx } from "./tx"

const signedTx = TxRaw.fromPartial({ bodyBytes: new Uint8Array([1]) })

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requestHandler = undefined
  mocks.validateAutoSign.mockReturnValue(false)
})

describe("useTx request boundary", () => {
  it("snapshots mutable payloads before awaiting gas and shows that same snapshot", async () => {
    const source = {
      messages: [
        {
          typeUrl: "/example.Msg",
          value: { amount: 7n, bytes: new Uint8Array([8, 9]) },
        },
      ],
      gasPrices: [{ denom: "uinit", amount: "0.01" }],
      spendCoins: [{ denom: "uinit", amount: "10" }],
    }
    mocks.createSigningClient.mockResolvedValue({
      simulate: vi.fn(async () => {
        source.messages[0]!.value.amount = 99n
        source.gasPrices[0]!.amount = "999"
        source.spendCoins[0]!.amount = "999"
        return 123
      }),
    } as unknown as SigningStargateClient)

    const pending = useTx()
      .requestTxBlock(source)
      .catch((error: unknown) => error)
    await vi.waitFor(() => expect(mocks.requestHandler).toBeDefined())

    expect(mocks.requestHandler!.txRequest).toMatchObject({
      messages: [
        {
          typeUrl: "/example.Msg",
          value: { amount: 7n, bytes: new Uint8Array([8, 9]) },
        },
      ],
      gas: 123,
      gasPrices: [{ denom: "uinit", amount: "0.01" }],
      spendCoins: [{ denom: "uinit", amount: "10" }],
    })

    const walletError = Object.assign(new Error("User rejected"), { code: 4001 })
    mocks.requestHandler!.reject(walletError)
    const error = await pending
    expect(error).toBe(walletError)
    expect((error as typeof walletError).code).toBe(4001)
    expect(isTxNotBroadcast(error)).toBe(true)
  })

  it("tags preparation failures as definitely not broadcast", async () => {
    const invalidMessage = {
      typeUrl: "/example.Msg",
      value: null as unknown as { amount: bigint; bytes: Uint8Array },
    }

    const error = await useTx()
      .requestTxBlock({ messages: [invalidMessage] })
      .catch((reason: unknown) => reason)
    expect(error).toBeInstanceOf(Error)
    expect(isTxNotBroadcast(error)).toBe(true)
  })

  it("preserves a formatted MoveError instance when failure occurs before broadcast", async () => {
    const moveError = new MoveError(
      "Registry message",
      new Error("VM aborted: location=1::module, code=1"),
      "0x1",
      "module",
      "1",
      "0x1",
      true,
    )
    mocks.createSigningClient.mockRejectedValue(moveError)

    const pending = useTx().requestTxBlock({
      messages: [
        {
          typeUrl: "/example.Msg",
          value: { amount: 7n, bytes: new Uint8Array([8, 9]) },
        },
      ],
      gas: 123,
    })
    await vi.waitFor(() => expect(mocks.requestHandler).toBeDefined())
    await mocks.requestHandler!.resolve(signedTx)
    const error = await pending.catch((reason: unknown) => reason)

    expect(error).toBe(moveError)
    expect(error).toBeInstanceOf(MoveError)
    expect(isTxNotBroadcast(error)).toBe(true)
  })

  it("does not classify a broadcaster error by its rejection-looking message", async () => {
    const broadcasterError = new Error("User rejected after submission")
    mocks.createSigningClient.mockResolvedValue({
      broadcastTx: vi.fn().mockRejectedValue(broadcasterError),
    } as unknown as SigningStargateClient)

    const pending = useTx().requestTxBlock({
      messages: [
        {
          typeUrl: "/example.Msg",
          value: { amount: 7n, bytes: new Uint8Array([8, 9]) },
        },
      ],
      gas: 123,
    })
    await vi.waitFor(() => expect(mocks.requestHandler).toBeDefined())
    await mocks.requestHandler!.resolve(signedTx)

    const error = await pending.catch((reason: unknown) => reason)
    expect(error).toBe(broadcasterError)
    expect(isTxNotBroadcast(error)).toBe(false)
  })

  it("keeps the ordinary non-auto-sign request path successful", async () => {
    const response = {
      code: 0,
      rawLog: "",
      transactionHash: "ABC123",
    } as DeliverTxResponse
    mocks.createSigningClient.mockResolvedValue({
      broadcastTx: vi.fn().mockResolvedValue(response),
    } as unknown as SigningStargateClient)

    const pending = useTx().requestTxBlock({
      messages: [
        {
          typeUrl: "/example.Msg",
          value: { amount: 7n, bytes: new Uint8Array([8, 9]) },
        },
      ],
      gas: 123,
    })
    await vi.waitFor(() => expect(mocks.requestHandler).toBeDefined())
    await mocks.requestHandler!.resolve(signedTx)

    await expect(pending).resolves.toBe(response)
  })

  it("snapshots messages and fee coins at the direct non-auto-sign entry", async () => {
    const source = {
      messages: [
        {
          typeUrl: "/example.Msg",
          value: { amount: 7n, bytes: new Uint8Array([8, 9]) },
        },
      ],
      fee: { amount: [{ denom: "uinit", amount: "10" }], gas: "123" },
    }
    let signedMessages: EncodeObject[] | undefined
    let signedFee: { amount: Array<{ denom: string; amount: string }> } | undefined
    mocks.manualSign.mockImplementation(
      async (
        _chainId: string,
        _address: string,
        messages: EncodeObject[],
        fee: { amount: Array<{ denom: string; amount: string }> },
      ) => {
        signedMessages = messages
        signedFee = fee
        source.messages[0]!.value.amount = 99n
        source.fee.amount[0]!.amount = "999"
        return signedTx
      },
    )
    const response = {
      code: 0,
      rawLog: "",
      transactionHash: "ABC123",
    } as DeliverTxResponse
    mocks.createSigningClient.mockResolvedValue({
      broadcastTx: vi.fn().mockResolvedValue(response),
    } as unknown as SigningStargateClient)

    await expect(useTx().submitTxBlock({ ...source, chainId: "initia-1" })).resolves.toBe(response)
    expect(signedMessages).toEqual([
      {
        typeUrl: "/example.Msg",
        value: { amount: 7n, bytes: new Uint8Array([8, 9]) },
      },
    ])
    expect(signedFee?.amount).toEqual([{ denom: "uinit", amount: "10" }])
  })
})
