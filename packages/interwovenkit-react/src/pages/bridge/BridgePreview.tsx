import Page from "@/components/Page"
import BridgePreviewFooter from "./BridgePreviewFooter"
import BridgePreviewRoute from "./BridgePreviewRoute"
import FooterWithAddressList from "./FooterWithAddressList"
import FooterWithErc20Approval from "./FooterWithErc20Approval"
import FooterWithMsgs from "./FooterWithMsgs"
import FooterWithSignedOpHook from "./FooterWithSignedOpHook"

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
                  {(tx) => (
                    <FooterWithErc20Approval tx={tx}>
                      <BridgePreviewFooter tx={tx} />
                    </FooterWithErc20Approval>
                  )}
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
