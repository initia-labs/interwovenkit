export function getBridgeConfirmLabel(
  confirmMessage: string | undefined,
  requiresReconfirm: boolean,
) {
  if (requiresReconfirm) return "Confirm updated route"

  return confirmMessage || "Confirm"
}
