import { BroadcastTxError } from "@cosmjs/stargate"

/** A transaction was included on-chain and execution definitively failed. */
export class TxExecutionError extends Error {
  constructor(
    message: string | undefined,
    readonly code: number,
    readonly transactionHash: string,
  ) {
    super(message || `Transaction failed with code ${code}`)
    this.name = "TxExecutionError"
  }
}

export function isConfirmedTxFailure(error: unknown): boolean {
  return error instanceof BroadcastTxError || error instanceof TxExecutionError
}
