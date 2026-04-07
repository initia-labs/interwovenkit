import type { TxJson } from "@skip-go/client"
import { shouldCheckExactFee, shouldRunExactFeeQuery } from "./exactFeeCheck"

describe("shouldCheckExactFee", () => {
  it("returns false for cosmos-to-initia routes", () => {
    expect(
      shouldCheckExactFee({
        isDstInitia: true,
        recipient: "init1recipient",
        route: {
          required_op_hook: false,
        },
        sender: "noble1sender",
        isSrcInitia: false,
        tx: {
          cosmos_tx: {
            msgs: [{ msg_type_url: "/cosmos.bank.v1beta1.MsgSend", msg: "{}" }],
          },
        } as TxJson,
      }),
    ).toBe(false)
  })

  it("returns false for initia-to-cosmos routes", () => {
    expect(
      shouldCheckExactFee({
        isDstInitia: false,
        recipient: "celestia1recipient",
        route: {
          required_op_hook: false,
        },
        sender: "init1sender",
        isSrcInitia: true,
        tx: {
          cosmos_tx: {
            msgs: [{ msg_type_url: "/cosmos.bank.v1beta1.MsgSend", msg: "{}" }],
          },
        } as TxJson,
      }),
    ).toBe(false)
  })

  it("returns true for initia-to-initia routes", () => {
    expect(
      shouldCheckExactFee({
        isDstInitia: true,
        recipient: "init1recipient",
        route: {
          required_op_hook: false,
        },
        sender: "init1sender",
        isSrcInitia: true,
        tx: {
          cosmos_tx: {
            msgs: [{ msg_type_url: "/cosmos.bank.v1beta1.MsgSend", msg: "{}" }],
          },
        } as TxJson,
      }),
    ).toBe(true)
  })
})

describe("shouldRunExactFeeQuery", () => {
  it("returns false until both balances and chain data are available", () => {
    expect(
      shouldRunExactFeeQuery({
        hasBalances: true,
        hasChain: false,
        requiresExactFeeCheck: true,
      }),
    ).toBe(false)
  })
})
