import { describe, expect, it } from "vitest"
import { GenericAuthorization } from "@initia/initia.proto/cosmos/authz/v1beta1/authz"
import { ExecuteAuthorization } from "@initia/initia.proto/initia/move/v1/authz"
import { CallAuthorization } from "@initia/initia.proto/minievm/evm/v1/authz"
import {
  doesObservedAuthorizationMatchPolicy,
  encodeAutoSignAuthorizations,
  validateAutoSignMessage,
} from "./policy"

describe("autosign permission adapters", () => {
  it("keeps MiniWasm available through a generic message policy", () => {
    const messageType = "/cosmwasm.wasm.v1.MsgExecuteContract"
    const policy = { kind: "generic" as const, messageTypes: [messageType] }
    const authorization = encodeAutoSignAuthorizations(policy)[0]!

    expect(GenericAuthorization.decode(authorization.value).msg).toBe(messageType)
    expect(
      validateAutoSignMessage(policy, {
        typeUrl: messageType,
        value: { contract: "init1contract", msg: new Uint8Array() },
      }),
    ).toMatchObject({ valid: true, enforcement: "on-chain" })
  })

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
  })

  it("matches verbatim REST typed Move authorizations", () => {
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
  })
})
