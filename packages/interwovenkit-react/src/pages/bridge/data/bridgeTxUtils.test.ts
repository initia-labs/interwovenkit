import type { KyInstance } from "ky"
import { fetchFirstCosmosTx } from "./bridgeTxUtils"

describe("fetchFirstCosmosTx", () => {
  const params = {
    addressList: ["init1sender", "init1recipient"],
    route: {
      amount_in: "100",
      amount_out: "90",
      source_asset_chain_id: "interwoven-1",
      source_asset_denom: "uinit",
      dest_asset_chain_id: "interwoven-2",
      dest_asset_denom: "uusdc",
      operations: [],
    },
    slippagePercent: "1",
  } as const

  it("returns the first cosmos transaction even when it is not the first tx entry", async () => {
    const json = vi.fn().mockResolvedValue({
      txs: [
        {
          evm_tx: {
            chain_id: "minievm-1",
            to: "0x1234",
            value: "0",
            data: "abcd",
          },
        },
        {
          cosmos_tx: {
            msgs: [{ msg_type_url: "/cosmos.bank.v1beta1.MsgSend", msg: "{}" }],
          },
        },
      ],
    })
    const post = vi.fn().mockReturnValue({ json })
    const skip = { post } as unknown as KyInstance

    const result = await fetchFirstCosmosTx(skip, params)

    expect(result).toEqual({
      msgs: [{ msg_type_url: "/cosmos.bank.v1beta1.MsgSend", msg: "{}" }],
    })
    expect(post).toHaveBeenCalledTimes(1)
    expect(post).toHaveBeenCalledWith("v2/fungible/msgs", {
      json: {
        address_list: params.addressList,
        amount_in: params.route.amount_in,
        amount_out: params.route.amount_out,
        source_asset_chain_id: params.route.source_asset_chain_id,
        source_asset_denom: params.route.source_asset_denom,
        dest_asset_chain_id: params.route.dest_asset_chain_id,
        dest_asset_denom: params.route.dest_asset_denom,
        slippage_tolerance_percent: params.slippagePercent,
        operations: params.route.operations,
        signed_op_hook: undefined,
      },
    })
  })

  it("throws when no cosmos transaction is present", async () => {
    const json = vi.fn().mockResolvedValue({
      txs: [{ evm_tx: { chain_id: "minievm-1", to: "0x1234", value: "0", data: "abcd" } }],
    })
    const post = vi.fn().mockReturnValue({ json })
    const skip = { post } as unknown as KyInstance

    await expect(fetchFirstCosmosTx(skip, params)).rejects.toThrow(
      "No cosmos transaction data found",
    )
  })
})
