import { z } from "zod"
import { BigNumber } from "bignumber.js"
import { toBaseUnit } from "@initia/utils"

export function quantitySuperRefine(
  {
    quantity,
    balance,
    decimals,
  }: {
    quantity: string
    balance: string | undefined
    decimals: number
  },
  ctx: z.RefinementCtx,
) {
  if (BigNumber(quantity).isZero()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Enter amount",
      path: ["quantity"],
    })
    return
  }

  if (!balance || BigNumber(toBaseUnit(quantity, { decimals })).gt(balance)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Insufficient balance",
      path: ["quantity"],
    })
    return
  }
}
