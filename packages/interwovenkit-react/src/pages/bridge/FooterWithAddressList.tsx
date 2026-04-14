import Button from "@/components/Button"
import Footer from "@/components/Footer"
import { useBridgeAddressListQuery } from "./data/preparation"
import { useBridgePreviewState } from "./data/tx"
import FooterWithError from "./FooterWithError"

import type { ReactNode } from "react"

interface Props {
  children: (addressList: string[]) => ReactNode
}

const FooterWithAddressList = ({ children }: Props) => {
  const state = useBridgePreviewState()
  const { route, values } = state
  const { data: addressList, error, isLoading } = useBridgeAddressListQuery(route, values)

  if (error) {
    return <FooterWithError error={error} />
  }

  if (isLoading) {
    return (
      <Footer>
        <Button.White loading="Generating intermediary addresses..." />
      </Footer>
    )
  }

  if (addressList) {
    return children(addressList)
  }

  return null
}

export default FooterWithAddressList
