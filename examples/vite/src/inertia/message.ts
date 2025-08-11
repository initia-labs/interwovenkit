import type { GeneratedType } from "@cosmjs/proto-signing"
import type { AminoConverters } from "@cosmjs/stargate"
import { MsgDeposit } from "@breezelabs/inertia.proto/inertia/loan/v1/tx"

export const inertiaRegistryTypes: ReadonlyArray<[string, GeneratedType]> = [
  // @ts-expect-error ignore
  ["/inertia.loan.v1.MsgDeposit", MsgDeposit],
]

export const aminoConverters: AminoConverters = {
  "/inertia.loan.v1.MsgDeposit": {
    aminoType: "loan/MsgDeposit",
    toAmino: ({ sender, accountId, coins }) => ({
      sender,
      account_id: accountId.toString(),
      coins,
    }),
    fromAmino: ({ sender, account_id, coins }) => ({
      sender,
      accountId: Number(account_id),
      coins,
    }),
  },
}
