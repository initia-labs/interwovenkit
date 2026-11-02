import type { OperationJson } from "@skip-go/client"
import { normalizeOperation } from "./operation"

describe("normalizeOperation", () => {
  it("labels an IBC transfer", () => {
    const operation = {
      transfer: {
        from_chain_id: "interwoven-1",
        to_chain_id: "injective-1",
        chain_id: "interwoven-1",
        denom_in: "ibc/A64E",
        denom_out: "erc20:0xa00C",
      },
      tx_index: 0,
      amount_in: "5000000",
      amount_out: "5000000",
    } as unknown as OperationJson

    expect(normalizeOperation(operation)).toMatchObject({
      label: "Bridge via IBC",
      to_chain_id: "injective-1",
      denom_out: "erc20:0xa00C",
      amount_out: "5000000",
    })
  })

  it("labels a CCTP v2 transfer", () => {
    const operation = {
      cctp_transfer_v2: {
        from_chain_id: "1776",
        to_chain_id: "8453",
        burn_token: "0xa00C59fF5a080D2b954d0c75e46E22a0c371235a",
        denom_in: "0xa00C59fF5a080D2b954d0c75e46E22a0c371235a",
        denom_out: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        bridge_id: "CCTP_V2",
        smart_relay: true,
      },
      tx_index: 0,
      amount_in: "5000000",
      amount_out: "4996526",
    } as unknown as OperationJson

    expect(normalizeOperation(operation)).toMatchObject({
      label: "Bridge via CCTP",
      from_chain_id: "1776",
      to_chain_id: "8453",
      denom_out: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      amount_out: "4996526",
    })
  })

  it("throws on an operation it does not know", () => {
    const operation = {
      unknown_transfer: {},
      tx_index: 0,
      amount_in: "1",
      amount_out: "1",
    } as unknown as OperationJson

    expect(() => normalizeOperation(operation)).toThrow("Unknown operation type")
  })
})
