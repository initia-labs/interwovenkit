# @initia/interwovenkit-react

`@initia/interwovenkit-react` is a React SDK that provides hooks and components to integrate Initia blockchain wallet connection, bridge functionality, and transaction signing into your React applications.

## Simple Example

Below is a minimal example to demonstrate core capabilities: connecting a wallet, opening the wallet drawer, opening the bridge drawer, and sending a transaction.

```tsx
import { MsgSend } from "cosmjs-types/cosmos/bank/v1beta1/tx"
import { truncate, useAddress, useInterwovenKit } from "@initia/interwovenkit-react"

const Example = () => {
  const address = useAddress()
  const { username, openConnect, openWallet, openBridge, requestTxBlock } = useInterwovenKit()

  if (!address) {
    return <button onClick={openConnect}>Connect</button>
  }

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

    const { transactionHash } = await requestTxBlock({ messages })
    console.log(transactionHash)
  }

  return (
    <>
      <header>
        <button
          onClick={() =>
            openBridge({
              srcChainId: "interwoven-1",
              srcDenom: "ibc/6490A7EAB61059BFC1CDDEB05917DD70BDF3A611654162A1A47DB930D40D8AF4",
              dstChainId: "interwoven-1",
              dstDenom: "uinit",
            })
          }
        >
          Bridge
        </button>

        <button onClick={openWallet}>{truncate(username ?? address)}</button>
      </header>

      <main>
        <button onClick={send}>Send</button>
      </main>
    </>
  )
}
```

## Getting Started

### Install Dependencies

Install the core package and required peer dependencies:

```bash
pnpm add @initia/interwovenkit-react
```

### Provider Setup

You must install a wallet connector to inject a wallet into the app.

```bash
pnpm add @tanstack/react-query wagmi
```

⚠️ Refer to the examples below.

- **Vite**: [examples/vite/src/Providers.tsx](https://github.com/initia-labs/interwovenkit/blob/main/examples/vite/src/Providers.tsx)
- **Next.js**: [examples/nextjs/src/app/providers.tsx](https://github.com/initia-labs/interwovenkit/blob/main/examples/nextjs/src/app/providers.tsx)

```tsx
import { InterwovenKit } from "@initia/interwovenkit-react"

const App = () => {
  return <InterwovenKit defaultChainId="YOUR_CHAIN_ID">{/* YOUR APP HERE */}</InterwovenKit>
}
```

**Using a custom chain configuration:**

```tsx
import { ChainSchema } from "@initia/initia-registry-types/zod"
import { InterwovenKit } from "@initia/interwovenkit-react"

const customChain = ChainSchema.parse({
  chain_id: "YOUR_CHAIN_ID",
  chain_name: "YOUR_CHAIN_NAME",
  apis: {
    rpc: [{ address: "YOUR_RPC_URL" }],
    rest: [{ address: "YOUR_LCD_URL" }],
  },
  fees: {
    fee_tokens: [{ denom: "YOUR_FEE_DENOM", fixed_min_gas_price: 0.015 }],
  },
  bech32_prefix: "init",
  network_type: "mainnet",
})

const App = () => {
  return (
    <InterwovenKit defaultChainId="YOUR_CHAIN_ID" customChain={customChain}>
      {/* YOUR APP HERE */}
    </InterwovenKit>
  )
}
```

## Configuration Interface

```ts
interface Config {
  /** Wallet integration interface. */
  wallet?: {
    meta: { icon?: string; name: string }
    address: string
    getEthereumProvider: () => Promise<Eip1193Provider>
    sign: (message: string) => Promise<string>
    disconnect: () => void
  }

  /** The default chain ID for wallet connection (registered in initia-registry). Defaults to "interwoven-1". */
  defaultChainId?: string

  /** Custom chain configuration when your chain is not registered in initia-registry. */
  customChain?: Chain

  /** Protobuf message types for custom transaction signing. */
  protoTypes?: Iterable<[string, GeneratedType]>

  /** Amino converters for encoding/decoding custom messages. */
  aminoConverters?: AminoConverters

  /** UI theme preference: "light" or "dark". */
  theme?: "light" | "dark"
}
```

## React Hooks API

### `useInterwovenKit()`

Provides core package state and actions:

```ts
interface UseInterwovenKitResult {
  /** Resolves to either the bech32 or hex address based on the current `minitia` type. */
  address: string

  /** Bech32-formatted Initia wallet address of the connected account. */
  initiaAddress: string

  /** Hex-encoded Ethereum-compatible address of the connected account. */
  hexAddress: string

  /** Optional username associated with the account. */
  username?: string | null

  /** Opens the wallet drawer UI. */
  openWallet(): void

  /** Opens the bridge drawer UI. */
  openBridge(defaultValues: Partial<FormValues>): void

  /** Estimates gas required for a transaction. */
  estimateGas(txRequest: TxRequest): Promise<number>

  /** Signs and broadcasts a transaction, waits for block inclusion, and returns the full transaction response. */
  requestTxBlock(txRequest: TxRequest): Promise<DeliverTxResponse>

  /** Signs and broadcasts a transaction and returns the transaction hash immediately. */
  requestTxSync(txRequest: TxRequest): Promise<string>

  /** Waits for a transaction to be confirmed on-chain. */
  waitForTxConfirmation(params: {
    txHash: string
    chainId?: string
    timeoutSeconds?: number
    intervalSeconds?: number
  }): Promise<IndexedTx>
}

interface TxRequest {
  messages: EncodeObject[]
  memo?: string
  chainId?: string
  gasAdjustment?: number
  gas?: number
  fee?: StdFee | null
}
```

## Usage on Testnet

```tsx
import { InterwovenKit, TESTNET } from "@initia/interwovenkit-react"

const App = () => {
  return <InterwovenKit {...TESTNET}>{/* YOUR APP HERE */}</InterwovenKit>
}
```

## Migrating From v1

To migrate from `@initia/react-wallet-widget` v1.x to `@initia/interwovenkit-react`, see our official migration guide:

[https://github.com/initia-labs/interwovenkit/blob/main/packages/interwovenkit-react/MIGRATION.md](https://github.com/initia-labs/interwovenkit/blob/main/packages/interwovenkit-react/MIGRATION.md)
