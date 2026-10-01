import { describe, expect, it } from "vitest"
import { GenericAuthorization } from "@initia/initia.proto/cosmos/authz/v1beta1/authz"
import { ExecuteAuthorization } from "@initia/initia.proto/initia/move/v1/authz"
import { CallAuthorization } from "@initia/initia.proto/minievm/evm/v1/authz"
import { InitiaAddress } from "@initia/utils"
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

  it("matches bech32 EVM targets against a hex policy", () => {
    const hex = "0x5FbDB2315678afecb367f032d93F642f64180aa3"
    const bech32 = InitiaAddress(hex).bech32
    const policy = { kind: "evm" as const, contracts: [hex] }

    expect(
      validateAutoSignMessage(policy, {
        typeUrl: "/minievm.evm.v1.MsgCall",
        value: { contractAddr: bech32, input: "0x" },
      }),
    ).toMatchObject({ valid: true, enforcement: "on-chain" })
    expect(
      CallAuthorization.decode(
        encodeAutoSignAuthorizations({ kind: "evm", contracts: [bech32] })[0]!.value,
      ).contracts,
    ).toEqual([hex])
    expect(
      doesObservedAuthorizationMatchPolicy(
        {
          authorization: { "@type": "/minievm.evm.v1.CallAuthorization", contracts: [bech32] },
        },
        policy,
      ),
    ).toBe(true)
    expect(
      validateAutoSignMessage(policy, {
        typeUrl: "/minievm.evm.v1.MsgCall",
        value: { contractAddr: InitiaAddress("0x2").bech32, input: "0x" },
      }).valid,
    ).toBe(false)
  })

  it("keeps non-20-byte EVM targets fail-closed", () => {
    for (const contract of ["0x1", "0x1234", `0x${"ab".repeat(32)}`, "init1invalid"]) {
      expect(() => encodeAutoSignAuthorizations({ kind: "evm", contracts: [contract] })).toThrow(
        "20-byte hex or bech32",
      )
    }
  })

  it("matches equivalent Move address forms and rejects different addresses", () => {
    const padded = `0x${"0".repeat(63)}1`
    const policy = {
      kind: "move" as const,
      items: [{ moduleAddress: "0x1", moduleName: "coin", functionNames: ["transfer"] }],
    }
    const message = (moduleAddress: string) => ({
      typeUrl: "/initia.move.v1.MsgExecute",
      value: { moduleAddress, moduleName: "coin", functionName: "transfer" },
    })

    expect(validateAutoSignMessage(policy, message(padded)).valid).toBe(true)
    expect(validateAutoSignMessage(policy, message(InitiaAddress("0x1").bech32)).valid).toBe(true)
    expect(validateAutoSignMessage(policy, message("0x2")).valid).toBe(false)
    expect(validateAutoSignMessage(policy, message("not-an-address")).valid).toBe(false)
    expect(
      doesObservedAuthorizationMatchPolicy(
        {
          authorization: {
            "@type": "/initia.move.v1.ExecuteAuthorization",
            items: [{ moduleAddress: padded, moduleName: "coin", functionNames: ["transfer"] }],
          },
        },
        policy,
      ),
    ).toBe(true)
    expect(
      doesObservedAuthorizationMatchPolicy(
        {
          authorization: {
            "@type": "/initia.move.v1.ExecuteAuthorization",
            items: [{ moduleAddress: "0x2", moduleName: "coin", functionNames: ["transfer"] }],
          },
        },
        policy,
      ),
    ).toBe(false)
    expect(() =>
      encodeAutoSignAuthorizations({
        kind: "move",
        items: [
          ...policy.items,
          { moduleAddress: padded, moduleName: "coin", functionNames: ["transfer"] },
        ],
      }),
    ).toThrow("cannot repeat a module")
    expect(() =>
      encodeAutoSignAuthorizations({
        kind: "move",
        items: [
          { moduleAddress: `0x${"0".repeat(65)}`, moduleName: "coin", functionNames: ["transfer"] },
        ],
      }),
    ).toThrow("exact modules")
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
