import { truncate } from "@initia/utils"
import Button from "@/components/Button"
import Footer from "@/components/Footer"
import FormHelp from "@/components/form/FormHelp"
import { getBridgeConfirmLabel } from "@/pages/bridge/confirmLabel"
import DepositTransferTxDetails from "./DepositTransferTxDetails"
import {
  type DepositTransportSelection,
  useDepositTransfer,
  useDepositTransportResolution,
} from "./useDepositTransfer"
import styles from "./TransferTxDetails.module.css"

const DepositTransferFooter = () => {
  const { resolution, retryCatalog, isCatalogFetching } = useDepositTransportResolution()
  if (resolution.transport === "router") return null
  if (resolution.transport !== "unavailable") {
    return <DepositTransferActions resolution={resolution} />
  }

  if (resolution.reason === "loading") {
    return (
      <Footer>
        <Button.White loading="Loading..." disabled fullWidth />
      </Footer>
    )
  }

  return (
    <Footer extra={<FormHelp level="error">Couldn&apos;t load deposit routes</FormHelp>}>
      <Button.White
        type="button"
        onClick={() => void retryCatalog()}
        loading={isCatalogFetching && "Retrying..."}
        fullWidth
      >
        Retry
      </Button.White>
    </Footer>
  )
}

const DepositTransferActions = ({ resolution }: { resolution: DepositTransportSelection }) => {
  const model = useDepositTransfer(resolution)
  const { approval, readiness, quoteUpdated } = model

  const isSending = model.isSubmitting
  const needsApproval = !!approval.approve
  // A blocked `info` reason is an input prompt, so it replaces the button label.
  const isPrompt = readiness.status === "blocked" && readiness.level === "info"
  const errorMessage =
    !isSending && readiness.status === "blocked" && readiness.level !== "info"
      ? readiness.message
      : undefined

  // Wallets like Rabby flag a recipient that isn't the connected account.
  const addressNotice =
    model.transport === "lifi" &&
    model.depositAddress &&
    readiness.status === "ready" &&
    !isSending &&
    !needsApproval &&
    !model.submitError &&
    !approval.error &&
    !quoteUpdated
      ? `This deposit goes to your personal Initia deposit address, ${truncate(model.depositAddress, [8, 6])}. Your wallet may warn that it's not your current address.`
      : undefined

  const loadingText = isSending
    ? "Signing transaction..."
    : approval.isApproving
      ? "Approving tokens..."
      : readiness.status === "loading"
        ? readiness.message || "Loading..."
        : false

  return (
    <>
      <DepositTransferTxDetails model={model} />
      <Footer
        extra={
          <FormHelp.Stack>
            {errorMessage && <FormHelp level={readiness.level ?? "error"}>{errorMessage}</FormHelp>}
            {model.submitError && <FormHelp level="error">{model.submitError}</FormHelp>}
            {approval.error && <FormHelp level="error">{approval.error}</FormHelp>}
            {quoteUpdated && (
              <FormHelp level="info">Route updated. Please review and confirm again.</FormHelp>
            )}
            {addressNotice && <p className={styles.notice}>{addressNotice}</p>}
          </FormHelp.Stack>
        }
      >
        {model.unknownSend && !isSending ? (
          // An ambiguous send must never re-enter the wallet; only progress can resolve it.
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
            {isPrompt
              ? readiness.message
              : needsApproval
                ? "Approve and deposit"
                : getBridgeConfirmLabel("Deposit", quoteUpdated)}
          </Button.White>
        )}
      </Footer>
    </>
  )
}

export default DepositTransferFooter
