// https://github.com/Abstract-Foundation/agw-sdk/blob/main/packages/agw-react/src/privy/injectWagmiConnector.tsx

import { type PropsWithChildren } from "react"

const InjectWagmiConnector = (props: PropsWithChildren) => {
  const { children } = props

  return children
}

export default InjectWagmiConnector
