import type { TxJson } from "@skip-go/client"
import {
  getErc20ApprovalStateKey,
  shouldResetErc20ApprovalMutationState,
} from "./footerWithErc20ApprovalState"

function createEvmTx(amount: string): TxJson {
  return {
    evm_tx: {
      chain_id: "arb-1",
      required_erc20_approvals: [
        {
          amount,
          spender: "0xspender",
          token_contract: "0xtoken",
        },
      ],
      signer_address: "0xsigner",
    },
  } as TxJson
}

describe("getErc20ApprovalStateKey", () => {
  it("stays stable for equivalent approval requirements", () => {
    expect(getErc20ApprovalStateKey(createEvmTx("10"))).toBe(
      getErc20ApprovalStateKey(createEvmTx("10")),
    )
  })
})

describe("shouldResetErc20ApprovalMutationState", () => {
  it("resets when approval requirements change after a transaction settles", () => {
    expect(
      shouldResetErc20ApprovalMutationState({
        currentKey: getErc20ApprovalStateKey(createEvmTx("10")),
        isPending: false,
        nextKey: getErc20ApprovalStateKey(createEvmTx("20")),
      }),
    ).toBe(true)
  })

  it("does not reset while an approval mutation is pending", () => {
    expect(
      shouldResetErc20ApprovalMutationState({
        currentKey: getErc20ApprovalStateKey(createEvmTx("10")),
        isPending: true,
        nextKey: getErc20ApprovalStateKey(createEvmTx("20")),
      }),
    ).toBe(false)
  })
})
