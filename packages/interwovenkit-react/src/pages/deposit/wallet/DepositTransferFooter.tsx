import Button from "@/components/Button"
import Footer from "@/components/Footer"
import FormHelp from "@/components/form/FormHelp"
import DepositTransferTxDetails from "./DepositTransferTxDetails"
import type { DepositTransportSelection } from "./useDepositTransfer"
import { useDepositTransfer } from "./useDepositTransfer"
import styles from "./DepositTransferFooter.module.css"

// There is no separate review page, so the "review after refresh" gate lives on this button:
// a stale quote is re-read inside the click, and only a materially changed one is shown again
// before it can reach the wallet.
const DepositTransferFooter = ({ resolution }: { resolution: DepositTransportSelection }) => {
  const model = useDepositTransfer(resolution)
  const { approval, readiness, quoteUpdated } = model

  const isApproving = approval.isApproving
  const isSending = model.isSubmitting
  const needsApproval = approval.required && !!approval.approve
  const actionLabel = needsApproval ? "Approve USDC" : "Deposit"

  // A blocked `info` reason is an input prompt, so it reads as the button's label.
  const isPrompt = readiness.status === "blocked" && readiness.level === "info"
  // While this footer's own send is pending, the button's sending state is the whole story.
  const errorMessage =
    !isSending && readiness.status === "blocked" && readiness.level !== "info"
      ? readiness.message
      : undefined

  const loadingText = isSending
    ? "Sending deposit..."
    : isApproving
      ? "Approving USDC..."
      : readiness.status === "loading"
        ? readiness.message || "Preparing..."
        : false

  return (
    <>
      <DepositTransferTxDetails model={model} />
      <Footer
        extra={
          // Sentences, not hashes: overrides the shared help style's break-all.
          <div className={styles.prose}>
            <FormHelp.Stack>
              {errorMessage && (
                <FormHelp level={readiness.level ?? "error"}>{errorMessage}</FormHelp>
              )}
              {model.submitError && <FormHelp level="error">{model.submitError}</FormHelp>}
              {approval.error && <FormHelp level="error">{approval.error}</FormHelp>}
              {quoteUpdated && (
                <FormHelp level="info">Quote updated. Review and confirm again.</FormHelp>
              )}
            </FormHelp.Stack>
          </div>
        }
      >
        {model.unknownSend && !isSending ? (
          // Nothing may re-enter the wallet here; progress resolves the ambiguous send.
          <Button.White type="button" onClick={model.openProgress} fullWidth>
            View progress
          </Button.White>
        ) : (
          <Button.White
            type="button"
            onClick={needsApproval ? approval.approve : model.submit}
            loading={loadingText}
            disabled={readiness.status !== "ready"}
            fullWidth
          >
            {isPrompt ? readiness.message : actionLabel}
          </Button.White>
        )}
      </Footer>
    </>
  )
}

export default DepositTransferFooter
