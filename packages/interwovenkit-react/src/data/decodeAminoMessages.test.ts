import { describe, expect, it, vi } from "vitest"
import { decodeCosmosAminoMessages } from "./decodeAminoMessages"

describe("decodeCosmosAminoMessages", () => {
  it("decodes valid amino messages with the provided converters", () => {
    const fromAmino = vi.fn(({ type, value }) => ({ typeUrl: type, value }))

    const result = decodeCosmosAminoMessages(
      [{ msg_type_url: "/cosmos.bank.v1beta1.MsgSend", msg: '{"amount":"1"}' }],
      {
        converters: {
          "/cosmos.bank.v1beta1.MsgSend": { aminoType: "cosmos-sdk/MsgSend" },
        },
        fromAmino,
      },
    )

    expect(fromAmino).toHaveBeenCalledWith({
      type: "cosmos-sdk/MsgSend",
      value: { amount: "1" },
    })
    expect(result).toEqual([{ typeUrl: "cosmos-sdk/MsgSend", value: { amount: "1" } }])
  })

  it("throws when a message is missing required fields", () => {
    expect(() =>
      decodeCosmosAminoMessages([{ msg_type_url: "/cosmos.bank.v1beta1.MsgSend" }], {
        converters: {
          "/cosmos.bank.v1beta1.MsgSend": { aminoType: "cosmos-sdk/MsgSend" },
        },
        fromAmino: vi.fn(),
      }),
    ).toThrow("Invalid transaction data")
  })

  it("throws when a converter is unavailable", () => {
    expect(() =>
      decodeCosmosAminoMessages(
        [{ msg_type_url: "/cosmos.bank.v1beta1.MsgSend", msg: '{"amount":"1"}' }],
        { converters: {}, fromAmino: vi.fn() },
      ),
    ).toThrow("Unsupported message type: /cosmos.bank.v1beta1.MsgSend")
  })
})
