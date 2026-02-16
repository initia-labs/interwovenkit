import { AminoTypes } from "@cosmjs/stargate"
import { describe, expect, it } from "vitest"
import {
  AllowedMsgAllowance,
  BasicAllowance,
} from "@initia/initia.proto/cosmos/feegrant/v1beta1/feegrant"
import { MsgGrantAllowance } from "@initia/initia.proto/cosmos/feegrant/v1beta1/tx"
import { patchedAminoConverters } from "./amino"

describe("patchedAminoConverters", () => {
  it("supports AllowedMsgAllowance in MsgGrantAllowance amino conversion", () => {
    const aminoTypes = new AminoTypes(patchedAminoConverters)

    const basicAllowance = {
      typeUrl: "/cosmos.feegrant.v1beta1.BasicAllowance",
      value: BasicAllowance.encode(BasicAllowance.fromPartial({})).finish(),
    }

    const message: MsgGrantAllowance = MsgGrantAllowance.fromPartial({
      granter: "init1granter",
      grantee: "init1grantee",
      allowance: {
        typeUrl: "/cosmos.feegrant.v1beta1.AllowedMsgAllowance",
        value: AllowedMsgAllowance.encode(
          AllowedMsgAllowance.fromPartial({
            allowance: basicAllowance,
            allowedMessages: ["/cosmos.authz.v1beta1.MsgExec"],
          }),
        ).finish(),
      },
    })

    const amino = aminoTypes.toAmino({
      typeUrl: "/cosmos.feegrant.v1beta1.MsgGrantAllowance",
      value: message,
    })

    expect(amino.type).toBe("cosmos-sdk/MsgGrantAllowance")
    expect(amino.value.allowance.type).toBe("cosmos-sdk/AllowedMsgAllowance")
    expect(amino.value.allowance.value.allowance.type).toBe("cosmos-sdk/BasicAllowance")
    expect(amino.value.allowance.value.allowed_messages).toEqual(["/cosmos.authz.v1beta1.MsgExec"])

    const roundTrip = aminoTypes.fromAmino(amino)
    const decodedAllowed = AllowedMsgAllowance.decode(
      (roundTrip.value as MsgGrantAllowance).allowance?.value ?? new Uint8Array(),
    )

    expect(roundTrip.typeUrl).toBe("/cosmos.feegrant.v1beta1.MsgGrantAllowance")
    expect((roundTrip.value as MsgGrantAllowance).allowance?.typeUrl).toBe(
      "/cosmos.feegrant.v1beta1.AllowedMsgAllowance",
    )
    expect(decodedAllowed.allowedMessages).toEqual(["/cosmos.authz.v1beta1.MsgExec"])
    expect(decodedAllowed.allowance?.typeUrl).toBe("/cosmos.feegrant.v1beta1.BasicAllowance")
  })

  it("supports recursively nested AllowedMsgAllowance values", () => {
    const aminoTypes = new AminoTypes(patchedAminoConverters)

    const basicAllowance = {
      typeUrl: "/cosmos.feegrant.v1beta1.BasicAllowance",
      value: BasicAllowance.encode(BasicAllowance.fromPartial({})).finish(),
    }

    const nestedAllowed = {
      typeUrl: "/cosmos.feegrant.v1beta1.AllowedMsgAllowance",
      value: AllowedMsgAllowance.encode(
        AllowedMsgAllowance.fromPartial({
          allowance: basicAllowance,
          allowedMessages: ["/cosmos.bank.v1beta1.MsgSend"],
        }),
      ).finish(),
    }

    const message: MsgGrantAllowance = MsgGrantAllowance.fromPartial({
      granter: "init1granter",
      grantee: "init1grantee",
      allowance: {
        typeUrl: "/cosmos.feegrant.v1beta1.AllowedMsgAllowance",
        value: AllowedMsgAllowance.encode(
          AllowedMsgAllowance.fromPartial({
            allowance: nestedAllowed,
            allowedMessages: ["/cosmos.authz.v1beta1.MsgExec"],
          }),
        ).finish(),
      },
    })

    const amino = aminoTypes.toAmino({
      typeUrl: "/cosmos.feegrant.v1beta1.MsgGrantAllowance",
      value: message,
    })

    expect(amino.value.allowance.type).toBe("cosmos-sdk/AllowedMsgAllowance")
    expect(amino.value.allowance.value.allowance.type).toBe("cosmos-sdk/AllowedMsgAllowance")

    const roundTrip = aminoTypes.fromAmino(amino)
    const decodedOuterAllowed = AllowedMsgAllowance.decode(
      (roundTrip.value as MsgGrantAllowance).allowance?.value ?? new Uint8Array(),
    )
    const decodedInnerAllowed = AllowedMsgAllowance.decode(
      decodedOuterAllowed.allowance?.value ?? new Uint8Array(),
    )

    expect(decodedOuterAllowed.allowedMessages).toEqual(["/cosmos.authz.v1beta1.MsgExec"])
    expect(decodedInnerAllowed.allowedMessages).toEqual(["/cosmos.bank.v1beta1.MsgSend"])
    expect(decodedInnerAllowed.allowance?.typeUrl).toBe("/cosmos.feegrant.v1beta1.BasicAllowance")
  })

  it("keeps non-Allowed allowances on the base converter path", () => {
    const aminoTypes = new AminoTypes(patchedAminoConverters)

    const message: MsgGrantAllowance = MsgGrantAllowance.fromPartial({
      granter: "init1granter",
      grantee: "init1grantee",
      allowance: {
        typeUrl: "/cosmos.feegrant.v1beta1.BasicAllowance",
        value: BasicAllowance.encode(BasicAllowance.fromPartial({})).finish(),
      },
    })

    const amino = aminoTypes.toAmino({
      typeUrl: "/cosmos.feegrant.v1beta1.MsgGrantAllowance",
      value: message,
    })

    expect(amino.value.allowance.type).toBe("cosmos-sdk/BasicAllowance")

    const roundTrip = aminoTypes.fromAmino(amino)
    expect((roundTrip.value as MsgGrantAllowance).allowance?.typeUrl).toBe(
      "/cosmos.feegrant.v1beta1.BasicAllowance",
    )
  })
})
