import Button from "@/components/Button"
import Footer from "@/components/Footer"
import FormHelp from "@/components/form/FormHelp"
import Page from "@/components/Page"
import BridgePreviewFooter from "./BridgePreviewFooter"
import { getBridgePreviewFooterState } from "./bridgePreviewFooterState"
import BridgePreviewRoute from "./BridgePreviewRoute"
import FooterWithAddressList from "./FooterWithAddressList"
import FooterWithErc20Approval from "./FooterWithErc20Approval"
import FooterWithExactFeeCheck from "./FooterWithExactFeeCheck"
import FooterWithMsgs from "./FooterWithMsgs"
import FooterWithSignedOpHook from "./FooterWithSignedOpHook"

function renderApprovalFooter({
  approvalError,
  approveTokens,
  isApproving,
}: {
  approvalError?: string
  approveTokens: () => void
  isApproving: boolean
}) {
  return (
    <Footer extra={approvalError && <FormHelp level="error">{approvalError}</FormHelp>}>
      <Button.White onClick={approveTokens} loading={isApproving && "Approving tokens..."}>
        Approve tokens
      </Button.White>
    </Footer>
  )
}

const BridgePreview = () => {
  return (
    <Page title="Route preview">
      <FooterWithAddressList>
        {(addressList) => (
          <>
            <BridgePreviewRoute addressList={addressList} />

            <FooterWithSignedOpHook>
              {(signedOpHook) => (
                <FooterWithMsgs addressList={addressList} signedOpHook={signedOpHook}>
                  {(tx, { isFetchingMessages, messageRefreshError }) => {
                    return (
                      <FooterWithExactFeeCheck tx={tx}>
                        {({ exactFeeCheckError, isCheckingFeeBalance }) => (
                          <FooterWithErc20Approval tx={tx}>
                            {({
                              approvalError,
                              approveTokens,
                              isApproving,
                              isCheckingApprovals,
                              requiresApproval,
                            }) => {
                              const footerState = getBridgePreviewFooterState({
                                approvalError,
                                approveTokens,
                                exactFeeCheckError,
                                isApproving,
                                isCheckingApprovals,
                                isCheckingFeeBalance,
                                isFetchingMessages,
                                messageRefreshError,
                                requiresApproval,
                              })

                              if (footerState.kind === "approval") {
                                return renderApprovalFooter({
                                  approvalError: footerState.approvalError,
                                  approveTokens: footerState.approveTokens,
                                  isApproving: footerState.isApproving,
                                })
                              }

                              return (
                                <BridgePreviewFooter
                                  tx={tx}
                                  error={footerState.error}
                                  isCheckingApprovals={footerState.isCheckingApprovals}
                                  isCheckingFeeBalance={footerState.isCheckingFeeBalance}
                                  isFetchingMessages={footerState.isFetchingMessages}
                                  messageRefreshError={footerState.messageRefreshError}
                                />
                              )
                            }}
                          </FooterWithErc20Approval>
                        )}
                      </FooterWithExactFeeCheck>
                    )
                  }}
                </FooterWithMsgs>
              )}
            </FooterWithSignedOpHook>
          </>
        )}
      </FooterWithAddressList>
    </Page>
  )
}

export default BridgePreview
