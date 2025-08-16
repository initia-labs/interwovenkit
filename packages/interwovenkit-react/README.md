# @initia/interwovenkit-react

InterwovenKit is a React library that provides components and hooks to connect dApps to Initia and Interwoven Rollups.

## Table of Contents

- [Features](#features)
- [Getting Started](#getting-started)
  - [Installation](#installation)
  - [Configure Providers](#configure-providers)
  - [Basic Example](#basic-example)
- [Usage on Testnet](#usage-on-testnet)
- [Migrating From v1](#migrating-from-v1)

## Features

### Connect

Connect to external wallets. Supports multiple wallet providers including MetaMask and Keplr.

### Wallet

Wallet interface for managing assets across Interwoven rollups:

- View fungible tokens
- Browse NFT items
- Track transaction history

### Bridge

Cross-chain bridge and swap functionality:

- Transfer assets between Initia and Interwoven rollups
- Swap tokens within and across chains
- Automatic route optimization for best rates
- Support for OP Bridge withdrawals

### Transaction Signing

Transaction handling with detailed preview:

- Fee estimation with multiple fee token options
- Transaction simulation before signing
- Detailed message breakdown

## Getting Started

### Installation

Install `@initia/interwovenkit-react` along with its peer dependencies:

```bash
pnpm add @initia/interwovenkit-react wagmi viem @tanstack/react-query
```

### Configure Providers

Wrap your app with providers:

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
        <InterwovenKitProvider defaultChainId="YOUR_CHAIN_ID">{children}</InterwovenKitProvider>
      </WagmiProvider>
    </QueryClientProvider>
  )
}
```

Then wrap your application root:

```tsx
// layout.tsx
import Providers from "./providers"

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
```

### Basic Example

Connect the wallet, check the balance, and send a transaction:

```tsx
// page.tsx
"use client"

import { MsgSend } from "cosmjs-types/cosmos/bank/v1beta1/tx"
import { truncate } from "@initia/utils"
import { useInterwovenKit } from "@initia/interwovenkit-react"

export default function Home() {
  const {
    address,
    username,
    openConnect,
    openWallet,
    openBridge,
    requestTxSync,
    waitForTxConfirmation,
  } = useInterwovenKit()

  const send = async () => {
    const messages = [
      {
        typeUrl: "/cosmos.bank.v1beta1.MsgSend",
        value: MsgSend.fromPartial({
          fromAddress: address,
          toAddress: address,
          amount: [{ amount: "1000000", denom: "uinit" }],
        }),
      },
    ]

    const transactionHash = await requestTxSync({ messages })
    console.log("Transaction sent:", transactionHash)

    await waitForTxConfirmation({ txHash: transactionHash })
    console.log("Transaction confirmed:", transactionHash)
  }

  const ETH = "move/edfcddacac79ab86737a1e9e65805066d8be286a37cb94f4884b892b0e39f954"
  const USDC = "ibc/6490A7EAB61059BFC1CDDEB05917DD70BDF3A611654162A1A47DB930D40D8AF4"

  const bridgeTransferDetails = {
    srcChainId: "interwoven-1",
    srcDenom: ETH,
    dstChainId: "interwoven-1",
    dstDenom: USDC,
  }

  if (!address) {
    return <button onClick={openConnect}>Connect</button>
  }

  return (
    <>
      <button onClick={send}>Send</button>
      <button onClick={() => openBridge(bridgeTransferDetails)}>Bridge</button>
      <button onClick={openWallet}>{truncate(username ?? address)}</button>
    </>
  )
}
```

## Usage on Testnet

```tsx
import type { PropsWithChildren } from "react"
import { InterwovenKitProvider, TESTNET } from "@initia/interwovenkit-react"

export default function Providers({ children }: PropsWithChildren) {
  return <InterwovenKitProvider {...TESTNET}>{children}</InterwovenKitProvider>
}
```

## Migrating From v1

To migrate from `@initia/react-wallet-widget` v1.x to `@initia/interwovenkit-react`, see our official migration guide:

[https://github.com/initia-labs/interwovenkit/blob/main/packages/interwovenkit-react/MIGRATION.md](https://github.com/initia-labs/interwovenkit/blob/main/packages/interwovenkit-react/MIGRATION.md)
