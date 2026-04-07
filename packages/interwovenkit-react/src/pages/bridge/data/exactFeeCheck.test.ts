import type { TxJson } from "@skip-go/client"
import type { NormalizedChain } from "@/data/chains"
import { getExactFeeCheckSetup } from "./exactFeeCheck"

describe("getExactFeeCheckSetup", () => {
  it("skips external routes without resolving initia registry chains", () => {
    const findChain = vi.fn(() => {
      throw new Error("should not resolve initia chain")
    })

    const result = getExactFeeCheckSetup({
      balances: {
        uusdc: { amount: "1000" },
      },
      dstChainType: "initia",
      findChain,
      recipient: "init1recipient",
      route: {
        amount_in: "100",
        required_op_hook: false,
      },
      sender: "noble1sender",
      srcChainId: "noble-1",
      srcChainType: "cosmos",
      srcDenom: "uusdc",
      tx: {
        cosmos_tx: {
          msgs: [{ msg_type_url: "/cosmos.bank.v1beta1.MsgSend", msg: "{}" }],
        },
      } as TxJson,
    })

    expect(result).toBeNull()
    expect(findChain).not.toHaveBeenCalled()
  })

  it("skips initia routes when the destination chain is external", () => {
    const findChain = vi.fn(() => {
      throw new Error("should not resolve initia chain")
    })

    const result = getExactFeeCheckSetup({
      balances: {
        uinit: { amount: "1000" },
      },
      dstChainType: "cosmos",
      findChain,
      recipient: "celestia1recipient",
      route: {
        amount_in: "100",
        required_op_hook: false,
      },
      sender: "init1sender",
      srcChainId: "initia-1",
      srcChainType: "initia",
      srcDenom: "uinit",
      tx: {
        cosmos_tx: {
          msgs: [{ msg_type_url: "/cosmos.bank.v1beta1.MsgSend", msg: "{}" }],
        },
      } as TxJson,
    })

    expect(result).toBeNull()
    expect(findChain).not.toHaveBeenCalled()
  })

  it("builds fee context for initia-to-initia routes", () => {
    const findChain = vi.fn(
      () =>
        ({
          fees: {
            fee_tokens: [{ denom: "uinit" }, { denom: "uusdc" }],
          },
        }) as NormalizedChain,
    )

    const result = getExactFeeCheckSetup({
      balances: {
        uinit: { amount: "2000" },
        uusdc: { amount: "500" },
      },
      dstChainType: "initia",
      findChain,
      recipient: "init1recipient",
      route: {
        amount_in: "100",
        required_op_hook: false,
      },
      sender: "init1sender",
      srcChainId: "initia-1",
      srcChainType: "initia",
      srcDenom: "uinit",
      tx: {
        cosmos_tx: {
          msgs: [{ msg_type_url: "/cosmos.bank.v1beta1.MsgSend", msg: "{}" }],
        },
      } as TxJson,
    })

    expect(findChain).toHaveBeenCalledWith("initia-1")
    expect(result).toEqual({
      balanceKey: "uinit:2000|uusdc:500",
    })
  })
})
