import type { TxJson } from "@skip-go/client"
import { shouldCheckExactFee, shouldRunExactFeeQuery } from "./exactFeeCheck"

describe("shouldCheckExactFee", () => {
  it("returns false for cosmos-to-initia routes", () => {
    expect(
      shouldCheckExactFee({
        route: {
          required_op_hook: false,
        },
        tx: {
          cosmos_tx: {
            msgs: [{ msg_type_url: "/cosmos.bank.v1beta1.MsgSend", msg: "{}" }],
          },
        } as TxJson,
        isSrcInitia: false,
        isDstInitia: true,
        sender: "noble1sender",
        recipient: "init1recipient",
      }),
    ).toBe(false)
  })

  it("returns false for initia-to-cosmos routes", () => {
    expect(
      shouldCheckExactFee({
        route: {
          required_op_hook: false,
        },
        tx: {
          cosmos_tx: {
            msgs: [{ msg_type_url: "/cosmos.bank.v1beta1.MsgSend", msg: "{}" }],
          },
        } as TxJson,
        isSrcInitia: true,
        isDstInitia: false,
        sender: "init1sender",
        recipient: "celestia1recipient",
      }),
    ).toBe(false)
  })

  it("returns true for initia-to-initia routes", () => {
    expect(
      shouldCheckExactFee({
        route: {
          required_op_hook: false,
        },
        tx: {
          cosmos_tx: {
            msgs: [{ msg_type_url: "/cosmos.bank.v1beta1.MsgSend", msg: "{}" }],
          },
        } as TxJson,
        isSrcInitia: true,
        isDstInitia: true,
        sender: "init1sender",
        recipient: "init1recipient",
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
