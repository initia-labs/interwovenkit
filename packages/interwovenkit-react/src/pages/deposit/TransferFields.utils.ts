import type { TransferLocationState } from "./state"

function getTransferStateAddresses(state: TransferLocationState) {
  const values = state.values as { recipient?: string; sender?: string } | undefined

  return { recipient: values?.recipient, sender: values?.sender }
}

export function shouldSyncTransferNavigationState({
  currentState,
  nextState,
}: {
  currentState: TransferLocationState
  nextState: TransferLocationState
}): boolean {
  if (currentState.route !== nextState.route) return true
  if (currentState.quoteVerifiedAt !== nextState.quoteVerifiedAt) return true

  const currentAddresses = getTransferStateAddresses(currentState)
  const nextAddresses = getTransferStateAddresses(nextState)

  return (
    currentAddresses.sender !== nextAddresses.sender ||
    currentAddresses.recipient !== nextAddresses.recipient
  )
}
