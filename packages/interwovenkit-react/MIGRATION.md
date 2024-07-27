# Migrating from v1 to v2

Follow these steps to update your code from v1 (`@initia/react-wallet-widget`) to v2 (`@initia/interwovenkit-react`).

## 1. Install and Imports

### Change package name

```diff
- pnpm add @initia/react-wallet-widget
+ pnpm add @initia/interwovenkit-react
```

### Update imports

All imports from `@initia/react-wallet-widget` must now come from `@initia/interwovenkit-react`.

## 2. Remove SSR Helpers

You no longer need SSR helpers or special build settings.

- Remove any imports from `@initia/react-wallet-widget/ssr`.
- Remove CDN scripts and `swcMinify: false` settings.

## 3. Install Peer Dependencies

Add the required peer dependencies:

```bash
pnpm add wagmi viem @tanstack/react-query
```

## 4. Provider Setup

```tsx
// providers.tsx
"use client"

import { PropsWithChildren, useEffect } from "react"
import { createConfig, http, WagmiProvider } from "wagmi"
import { mainnet } from "wagmi/chains"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import {
  initiaPrivyWalletConnector,
  injectStyles,
  InterwovenKitProvider,
} from "@initia/interwovenkit-react"
import InterwovenKitStyles from "@initia/interwovenkit-react/styles.js"

const wagmiConfig = createConfig({
  connectors: [initiaPrivyWalletConnector],
  chains: [mainnet],
  transports: { [mainnet.id]: http() },
})
const queryClient = new QueryClient()

export default function Providers({ children }: PropsWithChildren) {
  useEffect(() => {
    // Inject styles into the shadow DOM used by Initia Wallet
    injectStyles(InterwovenKitStyles)
  }, [])

  return (
    <QueryClientProvider client={queryClient}>
      <WagmiProvider config={wagmiConfig}>
        <InterwovenKitProvider defaultChainId="interwoven-1">{children}</InterwovenKitProvider>
      </WagmiProvider>
    </QueryClientProvider>
  )
}
```

## 5. Provider API Changes

### Renamed Props

```diff
- <WalletWidgetProvider chainId="interwoven-1" />
+ <InterwovenKitProvider defaultChainId="interwoven-1" />
```

```diff
- <WalletWidgetProvider customLayer={chain} />
+ <InterwovenKitProvider customChain={chain} />
```

### Move Bridge Defaults

```tsx
// v1
export default function Providers() {
  return (
    <WalletWidgetProvider
      bridgeOptions={{ defaultDstChainId: "interwoven-1", defaultDstAssetDenom: "uinit" }}
    />
  )
}
```

```tsx
// v2
import { InterwovenKitProvider, useInterwovenKit } from "@initia/interwovenkit-react"

export default function Home() {
  const { openBridge } = useInterwovenKit()

  return (
    <button onClick={() => openBridge({ dstChainId: "interwoven-1", dstDenom: "uinit" })}>
      Bridge
    </button>
  )
}
```

### Removed Props

`<InterwovenKitProvider>` no longer supports:

```diff
- <WalletWidgetProvider additionalWallets />
- <WalletWidgetProvider filterWallet />
```

To customize wallets, use wagmi connectors (see [https://wagmi.sh/react/api/connectors](https://wagmi.sh/react/api/connectors)).

## 6. Core Hooks & Methods

### Wallet Connection UI

```tsx
// v1
import { truncate } from "@initia/utils"
import { useWallet } from "@initia/react-wallet-widget"

export default function Home() {
  const { address, onboard, view, bridge, isLoading } = useWallet()

  if (!address) {
    return (
      <button onClick={onboard} disabled={isLoading}>
        {isLoading ? "Loading..." : "Connect"}
      </button>
    )
  }

  return (
    <>
      <button onClick={bridge}>Bridge</button>
      <button onClick={view}>{truncate(address)}</button>
    </>
  )
}
```

```tsx
// v2
import { truncate } from "@initia/utils"
import { useInterwovenKit } from "@initia/interwovenkit-react"

export default function Home() {
  const { address, openConnect, openWallet, openBridge } = useInterwovenKit()

  if (!address) {
    return <button onClick={openConnect}>Connect</button>
  }

  return (
    <>
      <button onClick={openBridge}>Bridge</button>
      <button onClick={openWallet}>{truncate(address)}</button>
    </>
  )
}
```

Ensure your app is wrapped in `<InterwovenKitProvider>` at the root

### Requesting a Transaction

```tsx
// v1
import { useWallet } from "@initia/react-wallet-widget"

export default function Home() {
  const { requestTx } = useWallet()

  const send = async () => {
    const transactionHash = await requestTx({ messages: [] }, { chainId: "interwoven-1" })
    console.log(transactionHash)
  }

  return <button onClick={send}>Submit</button>
}
```

```tsx
// v2
import { useInterwovenKit } from "@initia/interwovenkit-react"

export default function Home() {
  const { requestTxBlock } = useInterwovenKit()

  const send = async () => {
    const { transactionHash } = await requestTxBlock({ messages: [], chainId: "interwoven-1" })
    console.log(transactionHash)
  }

  return <button onClick={send}>Submit</button>
}
```

To first get the transaction hash before chain inclusion and later poll for confirmation, combine `requestTxSync()` with `waitForTxConfirmation()`.

## 7. Interoperability with `@initia/initia.js`

Use helpers to build message objects:

```tsx
import { MsgSend, Msg } from "@initia/initia.js"

function toEncodeObject(msg: Msg) {
  const data = msg.toData()
  return { typeUrl: data["@type"], value: msg.toProto() }
}

// Example usage
export default function Home() {
  const { initiaAddress, requestTxBlock } = useInterwovenKit()

  const mutate = async () => {
    const msgs = [
      MsgSend.fromProto({
        fromAddress: initiaAddress,
        toAddress: initiaAddress,
        amount: [{ amount: "1000000", denom: "uinit" }],
      }),
    ]

    const messages = msgs.map(toEncodeObject)
    const { transactionHash } = await requestTxBlock({ messages, chainId: "interwoven-1" })
    console.log(transactionHash)
  }

  return <button onClick={mutate}>Send</button>
}
```
