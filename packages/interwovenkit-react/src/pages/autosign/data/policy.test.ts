import { describe, expect, it } from "vitest"
import { ContractExecutionAuthorization } from "@initia/initia.proto/cosmwasm/wasm/v1/authz"
import { ExecuteAuthorization } from "@initia/initia.proto/initia/move/v1/authz"
import { CallAuthorization } from "@initia/initia.proto/minievm/evm/v1/authz"
import {
  doesObservedAuthorizationMatchPolicy,
  encodeAutoSignAuthorizations,
  observedAuthorizationToPermissionPolicy,
  parseObservedAuthorization,
  validateAutoSignMessage,
  validateAutoSignMessages,
} from "./policy"

describe("autosign permission adapters", () => {
  it("encodes the checksummed contract form required by MiniEVM", () => {
    const authorization = encodeAutoSignAuthorizations({
      kind: "evm",
      contracts: ["0x5a39b19c0a0472becf7a041c5f5a3b25aaecbf8d"],
    })[0]!
    expect(CallAuthorization.decode(authorization.value).contracts).toEqual([
      "0x5A39B19c0a0472BeCf7A041C5f5A3B25AaECbF8D",
    ])
  })

  it("encodes and validates exact Move module functions", () => {
    const policy = {
      kind: "move" as const,
      items: [{ moduleAddress: "0x1", moduleName: "dex", functionNames: ["swap"] }],
    }
    const authorization = encodeAutoSignAuthorizations(policy)[0]!

    expect(ExecuteAuthorization.decode(authorization.value).items).toEqual(policy.items)
    expect(
      validateAutoSignMessage(policy, {
        typeUrl: "/initia.move.v1.MsgExecute",
        value: { moduleAddress: "0x1", moduleName: "dex", functionName: "swap" },
      }),
    ).toMatchObject({ valid: true, enforcement: "on-chain" })
    expect(
      validateAutoSignMessage(policy, {
        typeUrl: "/initia.move.v1.MsgExecute",
        value: { moduleAddress: "0x1", moduleName: "dex", functionName: "withdraw" },
      }).valid,
    ).toBe(false)
    expect(
      doesObservedAuthorizationMatchPolicy(
        {
          authorization: {
            "@type": "/initia.move.v1.ExecuteAuthorization",
            items: [
              { moduleAddress: "0x1", moduleName: "dex", functionNames: ["swap"] },
              { moduleAddress: "0x1", moduleName: "dex", functionNames: ["swap"] },
            ],
          },
        },
        {
          ...policy,
          items: [
            ...policy.items,
            { moduleAddress: "0x2", moduleName: "coin", functionNames: ["send"] },
          ],
        },
      ),
    ).toBe(false)
  })

  it("requires nonempty EVM targets and labels selector guards SDK-only", () => {
    const policy = {
      kind: "evm" as const,
      contracts: ["0xAbc0000000000000000000000000000000000000"],
      selectors: ["0xaabbccdd"],
    }
    const authorization = encodeAutoSignAuthorizations(policy)[0]!

    expect(CallAuthorization.decode(authorization.value).contracts).toEqual([
      "0xabc0000000000000000000000000000000000000",
    ])
    expect(authorization.enforcement).toBe("sdk-only")
    expect(
      validateAutoSignMessage(policy, {
        typeUrl: "/minievm.evm.v1.MsgCall",
        value: {
          contractAddr: "0xabc0000000000000000000000000000000000000",
          input: "0xaabbccdd00",
        },
      }),
    ).toMatchObject({ valid: true, enforcement: "sdk-only" })
    expect(() => encodeAutoSignAuthorizations({ ...policy, contracts: [] })).toThrow("non-empty")
    expect(
      doesObservedAuthorizationMatchPolicy(
        {
          authorization: {
            "@type": "/minievm.evm.v1.CallAuthorization",
            contracts: ["0xabc0000000000000000000000000000000000000"],
          },
        },
        policy,
      ),
    ).toBe(true)

    const observed = parseObservedAuthorization({
      authorization: {
        "@type": "/cosmwasm.wasm.v1.ContractExecutionAuthorization",
        grants: [
          {
            contract: "init1accepted",
            filter: {
              "@type": "/cosmwasm.wasm.v1.AcceptedMessagesFilter",
              messages: [{ swap: { offer: "uinit", amount: "1" } }],
            },
            limit: { "@type": "/cosmwasm.wasm.v1.MaxCallsLimit", remaining: "1" },
          },
        ],
      },
    })
    expect(observedAuthorizationToPermissionPolicy(observed)).toEqual({
      kind: "wasm",
      grants: [
        {
          contract: "init1accepted",
          filter: {
            kind: "accepted-messages",
            messages: ['{"swap":{"amount":"1","offer":"uinit"}}'],
          },
          limit: { kind: "max-calls", remaining: 1n },
        },
      ],
    })
  })

  it("rejects an empty typed scope without falling back to a generic grant", () => {
    expect(() =>
      encodeAutoSignAuthorizations({
        kind: "wasm",
        grants: [],
      }),
    ).toThrow("Wasm permissions require explicit contract grants")
  })

  it("validates Wasm message-key filters against the submitted payload", () => {
    const policy = {
      kind: "wasm" as const,
      grants: [
        {
          contract: "init1contract",
          filter: { kind: "accepted-message-keys" as const, keys: ["swap"] },
          limit: { kind: "max-calls" as const, remaining: 2n },
        },
      ],
    }
    const message = (msg: string) => ({
      typeUrl: "/cosmwasm.wasm.v1.MsgExecuteContract",
      value: { contract: "init1contract", msg: new TextEncoder().encode(msg) },
    })

    expect(validateAutoSignMessage(policy, message('{"swap":{}}')).valid).toBe(true)
    expect(validateAutoSignMessage(policy, message('{"swap":{},"withdraw":{}}')).valid).toBe(false)
    expect(validateAutoSignMessage(policy, message("[]")).valid).toBe(false)
    expect(validateAutoSignMessage(policy, message('{"withdraw":{}}')).valid).toBe(false)
    const encoded = encodeAutoSignAuthorizations(policy)[0]!
    const observed = ContractExecutionAuthorization.toJSON(
      ContractExecutionAuthorization.decode(encoded.value),
    ) as Record<string, unknown>
    expect(
      doesObservedAuthorizationMatchPolicy(
        {
          authorization: {
            "@type": "/cosmwasm.wasm.v1.ContractExecutionAuthorization",
            ...observed,
          },
        },
        policy,
      ),
    ).toBe(true)
  })

  it("canonicalizes accepted Wasm JSON across owner-grant Amino normalization", () => {
    const policy = {
      kind: "wasm" as const,
      grants: [
        {
          contract: "init1contract",
          filter: {
            kind: "accepted-messages" as const,
            messages: ['{ "swap": { "offer": "uinit", "amount": "1" } }'],
          },
          limit: { kind: "max-calls" as const, remaining: 2n },
        },
      ],
    }
    const submitted = {
      typeUrl: "/cosmwasm.wasm.v1.MsgExecuteContract",
      value: {
        contract: "init1contract",
        msg: new TextEncoder().encode('{"swap":{"amount":"1","offer":"uinit"}}'),
      },
    }
    expect(validateAutoSignMessage(policy, submitted).valid).toBe(true)

    const encoded = encodeAutoSignAuthorizations(policy)[0]!
    const observed = ContractExecutionAuthorization.toJSON(
      ContractExecutionAuthorization.decode(encoded.value),
    ) as Record<string, unknown>
    expect(
      doesObservedAuthorizationMatchPolicy(
        {
          authorization: {
            "@type": "/cosmwasm.wasm.v1.ContractExecutionAuthorization",
            ...observed,
          },
        },
        policy,
      ),
    ).toBe(true)
    expect(() =>
      encodeAutoSignAuthorizations({
        ...policy,
        grants: [{ ...policy.grants[0]!, filter: { kind: "accepted-messages", messages: ["[]"] } }],
      }),
    ).toThrow("JSON objects")
  })

  it("matches verbatim REST typed Move and Wasm authorizations", () => {
    expect(
      doesObservedAuthorizationMatchPolicy(
        {
          authorization: {
            "@type": "/initia.move.v1.ExecuteAuthorization",
            items: [
              {
                module_address: "0x1",
                module_name: "dex",
                function_names: ["swap"],
              },
            ],
          },
        },
        {
          kind: "move",
          items: [{ moduleAddress: "0x1", moduleName: "dex", functionNames: ["swap"] }],
        },
      ),
    ).toBe(true)

    expect(
      doesObservedAuthorizationMatchPolicy(
        {
          authorization: {
            "@type": "/cosmwasm.wasm.v1.ContractExecutionAuthorization",
            grants: [
              {
                contract: "init1contract",
                filter: { "@type": "/cosmwasm.wasm.v1.AllowAllMessagesFilter" },
                limit: {
                  "@type": "/cosmwasm.wasm.v1.CombinedLimit",
                  calls_remaining: "1",
                  amounts: [{ denom: "uinit", amount: "5" }],
                },
              },
            ],
          },
        },
        {
          kind: "wasm",
          grants: [
            {
              contract: "init1contract",
              filter: { kind: "allow-all" },
              limit: {
                kind: "combined",
                callsRemaining: 1n,
                amounts: [{ denom: "uinit", amount: "5" }],
              },
            },
          ],
        },
      ),
    ).toBe(true)
  })

  it("accepts an observed Wasm funds subset after a denom is exhausted on chain", () => {
    const policy = {
      kind: "wasm" as const,
      grants: [
        {
          contract: "init1contract",
          filter: { kind: "allow-all" as const },
          limit: {
            kind: "combined" as const,
            callsRemaining: 2n,
            amounts: [
              { denom: "uinit", amount: "5" },
              { denom: "uusdc", amount: "10" },
            ],
          },
        },
      ],
    }

    expect(
      doesObservedAuthorizationMatchPolicy(
        {
          authorization: {
            "@type": "/cosmwasm.wasm.v1.ContractExecutionAuthorization",
            grants: [
              {
                contract: "init1contract",
                filter: { "@type": "/cosmwasm.wasm.v1.AllowAllMessagesFilter" },
                limit: {
                  "@type": "/cosmwasm.wasm.v1.CombinedLimit",
                  calls_remaining: "1",
                  // `Coins.Sub` omits uinit once all five units have been used.
                  amounts: [{ denom: "uusdc", amount: "10" }],
                },
              },
            ],
          },
        },
        policy,
      ),
    ).toBe(true)
  })

  it("uses only remaining Wasm contracts after another contract limit is exhausted", () => {
    const policy = {
      kind: "wasm" as const,
      grants: [
        {
          contract: "init1exhausted",
          filter: { kind: "allow-all" as const },
          limit: { kind: "max-calls" as const, remaining: 1n },
        },
        {
          contract: "init1remaining",
          filter: { kind: "allow-all" as const },
          limit: { kind: "max-calls" as const, remaining: 2n },
        },
      ],
    }
    const observed = {
      authorization: {
        "@type": "/cosmwasm.wasm.v1.ContractExecutionAuthorization",
        grants: [
          {
            contract: "init1remaining",
            filter: { "@type": "/cosmwasm.wasm.v1.AllowAllMessagesFilter" },
            limit: { "@type": "/cosmwasm.wasm.v1.MaxCallsLimit", remaining: "1" },
          },
        ],
      },
    }

    expect(doesObservedAuthorizationMatchPolicy(observed, policy)).toBe(true)
    const remainingPolicy = observedAuthorizationToPermissionPolicy(
      parseObservedAuthorization(observed),
    )
    expect(remainingPolicy).toMatchObject({
      kind: "wasm",
      grants: [expect.objectContaining({ contract: "init1remaining" })],
    })
    expect(
      validateAutoSignMessages(remainingPolicy!, [
        {
          typeUrl: "/cosmwasm.wasm.v1.MsgExecuteContract",
          value: {
            contract: "init1exhausted",
            msg: new TextEncoder().encode('{"run":{}}'),
          },
        },
      ]).valid,
    ).toBe(false)
    expect(
      doesObservedAuthorizationMatchPolicy(
        { authorization: { ...observed.authorization, grants: [] } },
        policy,
      ),
    ).toBe(false)
  })

  it("rejects invalid or negative Wasm funds before batch limit arithmetic", () => {
    const policy = {
      kind: "wasm" as const,
      grants: [
        {
          contract: "init1contract",
          filter: { kind: "allow-all" as const },
          limit: { kind: "max-funds" as const, amounts: [{ denom: "uinit", amount: "10" }] },
        },
      ],
    }
    expect(
      validateAutoSignMessages(policy, [
        {
          typeUrl: "/cosmwasm.wasm.v1.MsgExecuteContract",
          value: {
            contract: "init1contract",
            msg: new TextEncoder().encode('{"swap":{}}'),
            funds: [
              { denom: "uinit", amount: "10" },
              { denom: "uinit", amount: "-10" },
            ],
          },
        },
      ]),
    ).toMatchObject({ valid: false })
  })

  it("rejects a malformed observed Wasm funds limit without throwing", () => {
    const observedPolicy = observedAuthorizationToPermissionPolicy(
      parseObservedAuthorization({
        authorization: {
          "@type": "/cosmwasm.wasm.v1.ContractExecutionAuthorization",
          grants: [
            {
              contract: "init1contract",
              filter: { "@type": "/cosmwasm.wasm.v1.AllowAllMessagesFilter" },
              limit: {
                "@type": "/cosmwasm.wasm.v1.MaxFundsLimit",
                amounts: [{ denom: "uinit", amount: "invalid" }],
              },
            },
          ],
        },
      }),
    )

    expect(
      validateAutoSignMessages(observedPolicy!, [
        {
          typeUrl: "/cosmwasm.wasm.v1.MsgExecuteContract",
          value: {
            contract: "init1contract",
            msg: new TextEncoder().encode('{"swap":{}}'),
            funds: [{ denom: "uinit", amount: "1" }],
          },
        },
      ]),
    ).toMatchObject({ valid: false })
  })
})
