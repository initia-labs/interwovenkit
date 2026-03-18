import type { OfflineAminoSigner } from "@cosmjs/amino"
import { Secp256k1HdWallet } from "@cosmjs/amino"
import {
  type Chain,
  createWalletClient,
  type EIP1193Provider,
  EIP1193ProviderRpcError,
  http,
} from "viem"
import { mnemonicToAccount, privateKeyToAccount } from "viem/accounts"
import { mainnet } from "viem/chains"
import { injected } from "wagmi/connectors"
import type { CosmosWallet, CosmosWalletProvider } from "@/data/config"

// Browser-safe default RPCs. viem's built-in defaults (e.g. eth.merkle.io)
// reject cross-origin requests, breaking browser-based test wallets.
const DEFAULT_RPC_URLS: Record<number, string> = {
  1: "https://ethereum-rpc.publicnode.com",
  42161: "https://arbitrum-one-rpc.publicnode.com",
  8453: "https://base-rpc.publicnode.com",
}

export type CreateTestWalletOptions =
  | {
      /**
       * BIP-39 mnemonic phrase. Provide either `mnemonic` or `privateKey`.
       */
      mnemonic: string
      privateKey?: never
    }
  | {
      mnemonic?: never
      /**
       * Hex-encoded private key (with `0x` prefix).
       * Provide either `mnemonic` or `privateKey`.
       */
      privateKey: `0x${string}`
    }

export type CreateTestWalletConfig = CreateTestWalletOptions & {
  /**
   * Wagmi connector id. Useful when running multiple test wallets.
   * @default "testWallet"
   */
  id?: string
  /**
   * Display name shown in wallet selection UI.
   * @default "Test Wallet"
   */
  name?: string
  /**
   * CORS-friendly RPC URLs keyed by chain ID.
   * User-provided URLs override built-in defaults for matching chain IDs.
   */
  rpcUrls?: Record<number, string>
  /**
   * Log every RPC call to the console for debugging.
   * @default false
   */
  debug?: boolean
  /**
   * Override fields on every `eth_sendTransaction` call.
   * Useful for testing failure scenarios:
   * - `{ gas: 21000n }` — out of gas for contract calls (triggers revert)
   * - `{ maxFeePerGas: 1n }` — below base fee (rejected by RPC or stuck in mempool)
   */
  sendTransactionOverrides?: {
    gas?: bigint
    maxFeePerGas?: bigint
    maxPriorityFeePerGas?: bigint
  }
}

/**
 * Creates a wagmi-compatible wallet connector from a mnemonic or
 * private key for automated testing and local development.
 *
 * Browser wallets require manual interaction (popups, confirmations)
 * that cannot be driven programmatically. This connector creates an
 * in-memory EIP-1193 wallet that handles chain switching, transaction
 * signing, and gas estimation entirely in code. Standard contract
 * interactions (e.g. ERC-20 approvals) work via the RPC proxy.
 *
 * @example
 * ```ts
 * import { createTestWalletConnector } from "@initia/interwovenkit-react"
 *
 * // From mnemonic
 * const connector = createTestWalletConnector({
 *   mnemonic: process.env.TEST_MNEMONIC!,
 * })
 *
 * // Or from private key
 * const connector = createTestWalletConnector({
 *   privateKey: process.env.TEST_PRIVATE_KEY as `0x${string}`,
 * })
 *
 * const config = createConfig({
 *   connectors: [connector, ...otherConnectors],
 * })
 * ```
 *
 * ### Supported EIP-1193 methods
 *
 * | Method | Behavior |
 * | --- | --- |
 * | `eth_requestAccounts`, `eth_accounts` | Returns the account address |
 * | `eth_chainId` | Returns current chain ID (hex) |
 * | `personal_sign` | Signs with the account |
 * | `eth_signTypedData`, `eth_signTypedData_v4` | Simplified: signs raw bytes (not EIP-712 compliant) |
 * | `wallet_switchEthereumChain` | Switches chain; auto-registers from rpcUrls; throws 4902 if no RPC known |
 * | `wallet_addEthereumChain` | Registers a new chain with its RPC URL |
 * | `wallet_getPermissions`, `wallet_requestPermissions` | Returns `eth_accounts` permission |
 * | `eth_sendTransaction` | Signs locally via viem, broadcasts to RPC |
 * | *(any other method)* | Proxied to the current chain's RPC node |
 */
export function createTestWalletConnector(options: CreateTestWalletConfig) {
  const {
    id = "testWallet",
    name = "Test Wallet",
    rpcUrls: userRpcUrls,
    debug = false,
    sendTransactionOverrides,
  } = options

  if ("mnemonic" in options && options.mnemonic === "") {
    throw new Error("mnemonic must not be empty")
  }

  if (
    !("mnemonic" in options && options.mnemonic) &&
    !("privateKey" in options && options.privateKey)
  ) {
    throw new Error("Either mnemonic or privateKey is required")
  }

  // Guard above guarantees: if mnemonic is falsy, privateKey must exist.
  let account: ReturnType<typeof mnemonicToAccount> | ReturnType<typeof privateKeyToAccount>
  try {
    account = options.mnemonic
      ? mnemonicToAccount(options.mnemonic)
      : privateKeyToAccount(options.privateKey!)
  } catch (error) {
    throw new Error(
      `[${id}] Failed to create account from ${options.mnemonic ? "mnemonic" : "privateKey"}`,
      { cause: error },
    )
  }
  let currentChainId = 1

  type Listener = (...args: unknown[]) => void
  const listeners: Record<string, Set<Listener>> = {}

  // Not catching listener errors — test utility should surface bugs immediately.
  function emit(event: string, ...args: unknown[]) {
    listeners[event]?.forEach((fn) => {
      fn(...args)
    })
  }

  // Merge user overrides on top of built-in CORS-safe defaults
  const rpcOverrides: Record<number, string> = {
    ...DEFAULT_RPC_URLS,
    ...userRpcUrls,
  }

  // Extended dynamically via wallet_addEthereumChain
  const chains: Record<number, Chain> = { 1: mainnet }

  function getRpcUrl(chainId: number): string {
    if (rpcOverrides[chainId]) return rpcOverrides[chainId]
    const chain = chains[chainId]
    if (chain) return chain.rpcUrls.default.http[0]
    throw new Error(`[${id}] No RPC configured for chain ${chainId}`)
  }

  interface JsonRpcResponse {
    result?: unknown
    error?: { code: number; message: string }
  }

  async function rpcRequest(method: string, params?: unknown[]): Promise<unknown> {
    const rpcUrl = getRpcUrl(currentChainId)
    const response = await fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: params ?? [] }),
    })

    if (!response.ok) {
      throw new Error(
        `[${id}] RPC "${method}" failed: HTTP ${response.status} ${response.statusText} (${rpcUrl})`,
      )
    }

    let json: JsonRpcResponse
    try {
      json = await response.json()
    } catch (parseError) {
      throw new Error(`[${id}] RPC "${method}" returned non-JSON response (${rpcUrl})`, {
        cause: parseError,
      })
    }

    if (json.error) {
      throw new EIP1193ProviderRpcError(json.error.code, json.error.message)
    }

    return json.result
  }

  const provider = {
    request: async ({ method, params }: { method: string; params?: unknown[] }) => {
      if (debug) {
        // eslint-disable-next-line no-console
        console.log(`[${id}] ${method}`, params)
      }

      switch (method) {
        case "eth_requestAccounts":
        case "eth_accounts":
          return [account.address]

        case "eth_chainId":
          return `0x${currentChainId.toString(16)}`

        case "wallet_switchEthereumChain": {
          const [{ chainId }] = params as [{ chainId: string }]
          const numericId = Number(chainId)
          // Throw 4902 so the dApp calls wallet_addEthereumChain with the RPC URL.
          // ethers BrowserProvider's internal #request reads `e.code` from the caught
          // value, then wraps it into a JSON-RPC error structure. EIP1193ProviderRpcError
          // ensures `code` survives the entire ethers error-wrapping pipeline.
          if (!chains[numericId] && !rpcOverrides[numericId]) {
            throw new EIP1193ProviderRpcError(4902, "Unrecognized chain ID")
          }
          // Auto-register chain from rpcOverrides so that
          // createWalletClient receives a valid chain object.
          if (!chains[numericId] && rpcOverrides[numericId]) {
            chains[numericId] = {
              id: numericId,
              name: `Chain ${numericId}`,
              nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
              rpcUrls: { default: { http: [rpcOverrides[numericId]] } },
            }
          }
          currentChainId = numericId
          emit("chainChanged", chainId)
          return null
        }

        case "wallet_addEthereumChain": {
          const [info] = params as [{ chainId: string; rpcUrls?: string[]; chainName?: string }]
          const rpcUrl = info.rpcUrls?.[0]
          if (!rpcUrl) {
            throw new Error(`[${id}] wallet_addEthereumChain requires at least one RPC URL`)
          }
          const numericId = Number(info.chainId)
          // Does not auto-switch to the new chain (unlike MetaMask).
          // Callers should follow up with wallet_switchEthereumChain.
          if (chains[numericId]) {
            if (debug) {
              // eslint-disable-next-line no-console
              console.log(`[${id}] Chain ${numericId} already registered, skipping`)
            }
          } else {
            chains[numericId] = {
              id: numericId,
              name: info.chainName ?? `Chain ${numericId}`,
              nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
              rpcUrls: { default: { http: [rpcUrl] } },
            }
          }
          return null
        }

        case "personal_sign": {
          const [message] = params as [string]
          return account.signMessage({ message: { raw: message as `0x${string}` } })
        }

        case "eth_signTypedData":
        case "eth_signTypedData_v4": {
          // Simplified: signs raw data bytes instead of following EIP-712 encoding.
          // Actual typed-data signatures (e.g. Permit2) will not validate on-chain.
          // InterwovenKit only uses personal_sign for key derivation, so this is
          // sufficient for its use cases.
          const [, data] = params as [string, string]
          return account.signMessage({ message: { raw: data as `0x${string}` } })
        }

        case "wallet_getPermissions":
        case "wallet_requestPermissions":
          return [{ parentCapability: "eth_accounts" }]

        case "eth_sendTransaction": {
          const [txParams] = params as [Record<string, string>]
          const chain = chains[currentChainId]
          if (!chain) {
            throw new Error(
              `[${id}] No chain registered for chain ${currentChainId}. Call wallet_switchEthereumChain first.`,
            )
          }
          const walletClient = createWalletClient({
            account,
            chain,
            transport: http(getRpcUrl(currentChainId)),
          })
          return walletClient.sendTransaction({
            to: txParams.to as `0x${string}`,
            value: txParams.value ? BigInt(txParams.value) : undefined,
            data: txParams.data as `0x${string}` | undefined,
            chainId: currentChainId,
            ...sendTransactionOverrides,
          })
        }

        // Forward all other methods (eth_estimateGas, eth_gasPrice,
        // eth_getTransactionReceipt, eth_call, etc.) to the RPC node.
        default:
          return rpcRequest(method, params)
      }
    },
    on: (event: string, fn: Listener) => {
      ;(listeners[event] ??= new Set()).add(fn)
    },
    removeListener: (event: string, fn: Listener) => {
      listeners[event]?.delete(fn)
    },
    removeAllListeners: () => {
      for (const key of Object.keys(listeners)) delete listeners[key]
    },
  }

  return injected({
    target: () => ({
      id,
      name,
      // Duck-typed EIP-1193 provider. wagmi's injected connector target
      // expects overloaded signatures that a generic implementation cannot satisfy.
      provider: provider as unknown as EIP1193Provider,
    }),
  })
}

// Well-known Cosmos chain ID → bech32 prefix mappings.
// Chains whose prefix matches the chain ID stem (e.g. "noble-1" → "noble")
// are also listed for explicitness and to avoid heuristic surprises.
const COSMOS_PREFIX_MAP: Record<string, string> = {
  "noble-1": "noble",
  celestia: "celestia",
  "neutron-1": "neutron",
  "osmosis-1": "osmo",
}

export interface CreateTestCosmosWalletConfig {
  /**
   * BIP-39 mnemonic phrase used to derive Cosmos accounts.
   */
  mnemonic: string
  /**
   * Display name shown in the wallet selection list.
   * @default "Test Cosmos Wallet"
   */
  name?: string
  /**
   * Wallet icon URL. Omit to show the default placeholder.
   */
  image?: string
  /**
   * Override the bech32 prefix for specific chain IDs.
   * By default, the prefix is derived from the chain ID
   * (e.g. `noble-1` → `noble`). Use this for chains where
   * the prefix differs from the chain ID stem.
   *
   * @example
   * ```ts
   * chains: {
   *   "cosmoshub-4": { prefix: "cosmos" },
   *   "osmosis-1": { prefix: "osmo" },
   * }
   * ```
   */
  chains?: Record<string, { prefix: string }>
  /**
   * Log signer creation to the console for debugging.
   * @default false
   */
  debug?: boolean
}

/**
 * Creates a Cosmos wallet for the Bridge wallet selection list,
 * backed by a mnemonic-derived `Secp256k1HdWallet` (standard Cosmos
 * secp256k1 signing). Designed for automated testing and local
 * development against chains like Noble and Neutron.
 *
 * Pass the returned wallet via the `cosmosWallets` config prop
 * on `InterwovenKitProvider`. It will appear in the Bridge's
 * "Connect wallet" list alongside Keplr and Leap.
 *
 * @example
 * ```ts
 * import {
 *   InterwovenKitProvider,
 *   createTestCosmosWallet,
 * } from "@initia/interwovenkit-react"
 *
 * const testCosmosWallet = createTestCosmosWallet({
 *   mnemonic: process.env.TEST_COSMOS_MNEMONIC!,
 * })
 *
 * function App() {
 *   return (
 *     <InterwovenKitProvider cosmosWallets={[testCosmosWallet]}>
 *       {children}
 *     </InterwovenKitProvider>
 *   )
 * }
 * ```
 */
export function createTestCosmosWallet(config: CreateTestCosmosWalletConfig): CosmosWallet {
  const { mnemonic, name = "Test Cosmos Wallet", image, chains, debug = false } = config

  if (!mnemonic) {
    throw new Error("mnemonic is required")
  }

  // Cache wallet instances per bech32 prefix. Stores the Promise itself
  // so concurrent calls for the same prefix share a single derivation.
  const walletCache = new Map<string, Promise<Secp256k1HdWallet>>()

  function resolvePrefix(chainId: string): string {
    if (chains?.[chainId]) return chains[chainId].prefix
    if (COSMOS_PREFIX_MAP[chainId]) return COSMOS_PREFIX_MAP[chainId]
    // Default: strip trailing version suffix (e.g. "noble-1" → "noble")
    return chainId.replace(/-\d+$/, "")
  }

  function getOrCreateWallet(chainId: string): Promise<Secp256k1HdWallet> {
    const prefix = resolvePrefix(chainId)
    const cached = walletCache.get(prefix)
    if (cached) return cached

    if (debug) {
      // eslint-disable-next-line no-console
      console.log(`[${name}] Creating wallet for chain ${chainId} (prefix: ${prefix})`)
    }

    const promise = Secp256k1HdWallet.fromMnemonic(mnemonic, { prefix })
    promise.catch((error) => {
      walletCache.delete(prefix)
      // eslint-disable-next-line no-console
      console.error(`[${name}] Failed to create wallet for prefix "${prefix}":`, error)
    })
    walletCache.set(prefix, promise)
    return promise
  }

  // Returns an OfflineAminoSigner synchronously. The async wallet
  // derivation is deferred to when getAccounts/signAmino are called.
  function createLazySigner(chainId: string): OfflineAminoSigner {
    return {
      async getAccounts() {
        const wallet = await getOrCreateWallet(chainId)
        return wallet.getAccounts()
      },
      async signAmino(signerAddress, signDoc) {
        const wallet = await getOrCreateWallet(chainId)
        return wallet.signAmino(signerAddress, signDoc)
      },
    }
  }

  const provider: CosmosWalletProvider = {
    getOfflineSigner(chainId: string) {
      return createLazySigner(chainId)
    },
    getOfflineSignerOnlyAmino(chainId: string) {
      return createLazySigner(chainId)
    },
  }

  return {
    name,
    image,
    getProvider: () => provider,
  }
}
