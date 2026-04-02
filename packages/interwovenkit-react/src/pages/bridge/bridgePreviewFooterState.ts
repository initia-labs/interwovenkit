export type BridgePreviewFooterState =
  | {
      kind: "approval"
      approvalError?: string
      approveTokens: () => void
      isApproving: boolean
    }
  | {
      kind: "preview"
      error?: string
      isCheckingApprovals?: boolean
      isCheckingFeeBalance?: boolean
      isFetchingMessages?: boolean
      messageRefreshError?: string
    }

export function getBridgePreviewFooterState({
  approvalError,
  approveTokens,
  exactFeeCheckError,
  isApproving,
  isCheckingApprovals,
  isCheckingFeeBalance,
  isFetchingMessages,
  messageRefreshError,
  requiresApproval,
}: {
  approvalError?: string
  approveTokens?: () => void
  exactFeeCheckError?: string
  isApproving?: boolean
  isCheckingApprovals?: boolean
  isCheckingFeeBalance?: boolean
  isFetchingMessages?: boolean
  messageRefreshError?: string
  requiresApproval?: boolean
}): BridgePreviewFooterState {
  if (isFetchingMessages || messageRefreshError) {
    return {
      kind: "preview",
      isFetchingMessages,
      messageRefreshError,
    }
  }

  if (isCheckingFeeBalance) {
    return { kind: "preview", isCheckingFeeBalance: true }
  }

  if (exactFeeCheckError) {
    return { kind: "preview", error: exactFeeCheckError }
  }

  if (isCheckingApprovals) {
    return { kind: "preview", isCheckingApprovals: true }
  }

  if (requiresApproval && approveTokens) {
    return {
      kind: "approval",
      approvalError,
      approveTokens,
      isApproving: !!isApproving,
    }
  }

  return { kind: "preview" }
}
