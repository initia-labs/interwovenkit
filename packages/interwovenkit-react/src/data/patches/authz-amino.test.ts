import { AminoTypes } from "@cosmjs/stargate"
import { describe, expect, it } from "vitest"
import { MsgGrant } from "@initia/initia.proto/cosmos/authz/v1beta1/tx"
import {
  AcceptedMessagesFilter,
  ContractExecutionAuthorization,
} from "@initia/initia.proto/cosmwasm/wasm/v1/authz"
import { buildAutoSignGrantMessages } from "@/pages/autosign/data/grant"
import type { AutoSignPermissionPolicy } from "@/pages/autosign/data/policy"
import { patchedAminoConverters } from "./amino"

const aminoTypes = new AminoTypes(patchedAminoConverters)
const policies: AutoSignPermissionPolicy[] = [
  {
    kind: "move",
    items: [{ moduleAddress: "0x1", moduleName: "coin", functionNames: ["transfer"] }],
  },
  {
    kind: "evm",
    contracts: ["0x0000000000000000000000000000000000000001"],
  },
  {
    kind: "wasm",
    grants: [
      {
        contract: "init1contract",
        filter: { kind: "accepted-message-keys", keys: ["swap"] },
        limit: {
          kind: "combined",
          callsRemaining: 5n,
          amounts: [{ denom: "uinit", amount: "100" }],
        },
      },
    ],
  },
]

describe("typed grant wallet signing conversion", () => {
  it.each([
    ["2030-01-01T00:00:00.000Z", "2030-01-01T00:00:00Z"],
    ["2030-01-01T00:00:00.120Z", "2030-01-01T00:00:00.12Z"],
    ["2030-01-01T00:00:00.123Z", "2030-01-01T00:00:00.123Z"],
  ])("matches Go timestamp formatting for grants and fee allowances: %s", (iso, expected) => {
    for (const authorization of policies) {
      const messages = buildAutoSignGrantMessages({
        granter: "init1owner",
        grantee: "init1grantee",
        messageTypes: [],
        authorization,
        expiration: new Date(iso),
      })
      const fee = aminoTypes.toAmino(messages[0]!)
      expect(fee.value.allowance.value.allowance.value.expiration).toBe(expected)
      const grant = aminoTypes.toAmino(messages[1]!)
      expect(grant.value.grant.expiration).toBe(expected)
      expect(aminoTypes.fromAmino(grant).value.grant.expiration.toISOString()).toBe(iso)
    }
  })

  it.each(policies)("preserves the $kind authorization through Amino signing", (authorization) => {
    const message = buildAutoSignGrantMessages({
      granter: "init1owner",
      grantee: "init1grantee",
      messageTypes: [],
      authorization,
      expiration: new Date("2030-01-01T00:00:00Z"),
    })[1]!
    const amino = aminoTypes.toAmino(message)
    if (authorization.kind === "move") {
      expect(amino.value.grant.authorization.value.items[0].function_names).toEqual(["transfer"])
      expect(amino.value.grant.authorization.value.items[0]).not.toHaveProperty("function_name")
    }
    const restored = aminoTypes.fromAmino(amino)
    expect(restored.typeUrl).toBe(message.typeUrl)
    expect(MsgGrant.encode(restored.value).finish()).toEqual(
      MsgGrant.encode(message.value as MsgGrant).finish(),
    )
  })

  it("writes accepted Wasm messages as inline JSON and preserves canonical protobuf bytes", () => {
    const message = buildAutoSignGrantMessages({
      granter: "init1owner",
      grantee: "init1grantee",
      messageTypes: [],
      authorization: {
        kind: "wasm",
        grants: [
          {
            contract: "init1contract",
            limit: { kind: "max-calls", remaining: 2n },
            filter: { kind: "accepted-messages", messages: ['{ "swap": {"z": 1, "a": 2} }'] },
          },
        ],
      },
    })[1]!
    const amino = aminoTypes.toAmino(message)
    expect(amino.value.grant.authorization.value.grants[0].filter.value.messages).toEqual([
      { swap: { a: 2, z: 1 } },
    ])
    const restored = aminoTypes.fromAmino(amino)
    const grant = restored.value as MsgGrant
    const authorization = ContractExecutionAuthorization.decode(grant.grant!.authorization!.value)
    const filter = AcceptedMessagesFilter.decode(authorization.grants[0]!.filter!.value)
    expect(new TextDecoder().decode(filter.messages[0])).toBe('{"swap":{"a":2,"z":1}}')
    expect(MsgGrant.encode(grant).finish()).toEqual(
      MsgGrant.encode(message.value as MsgGrant).finish(),
    )
  })
})
