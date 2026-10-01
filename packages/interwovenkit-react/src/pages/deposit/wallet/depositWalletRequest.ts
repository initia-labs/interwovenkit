export interface DepositWalletProvider {
  // Test wallet flags: its chain switch needs no confirmation, or it signs on the request's chain.
  silentChainSwitch?: boolean
  signsOnRequestedChain?: boolean
  request(args: { method: string; params?: unknown[] }): Promise<unknown>
  on?(event: string, listener: (...args: unknown[]) => void): void
  removeListener?(event: string, listener: (...args: unknown[]) => void): void
}

export interface WalletTransaction {
  chainId: string
  from: string
  to: string
  data: string
  value: string
  gas?: string
}

// How a wallet gets to the source chain: not at all (it signs on the request's chain), switched
// while preparing, switched in the Deposit click, or through its own "Switch to" step.
export type ChainSwitchMode = "none" | "silent" | "inline" | "prompt"

// Privy signs on the transaction's chainId whatever chain it's on, and switching it to a chain
// missing from the host's wagmi config breaks it, so it never switches. Extension wallets sign in
// their own window, so the click switches and the send follows once the request is prepared on the
// new chain. Others, such as WalletConnect or Coinbase's smart wallet, keep a separate step.
export function getChainSwitchMode(
  connectorType: string,
  provider: DepositWalletProvider,
): ChainSwitchMode {
  if (connectorType === "privy" || provider.signsOnRequestedChain) return "none"
  if (provider.silentChainSwitch) return "silent"
  if (connectorType === "injected" || connectorType === "metaMask") return "inline"
  return "prompt"
}

export type PreparedWalletRequest =
  | { status: "wrong_chain"; provider: DepositWalletProvider }
  | { status: "ready"; provider: DepositWalletProvider; transaction: WalletTransaction }

export function parseDepositWalletProvider(value: unknown): DepositWalletProvider {
  if (typeof value !== "object" || value === null || !("request" in value)) {
    throw new Error("Wallet provider not available")
  }
  const { request } = value
  if (typeof request !== "function") throw new Error("Wallet provider not available")
  return value as DepositWalletProvider
}

function hexQuantity(value: string): string {
  return `0x${BigInt(value).toString(16)}`
}

function parseHexQuantity(value: unknown): string {
  if (typeof value !== "string" || !/^0x[0-9a-f]+$/i.test(value)) {
    throw new Error("Your wallet returned an invalid gas estimate")
  }
  return value
}

function parseChainId(value: unknown): bigint {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return BigInt(value)
  if (typeof value === "string" && /^(0x[0-9a-f]+|[0-9]+)$/i.test(value)) return BigInt(value)
  throw new Error("Your wallet returned an invalid chain ID")
}

export async function prepareWalletRequest(params: {
  provider: DepositWalletProvider
  sender: string
  chainId: string
  to: string
  data: string
  value: string
  gasLimit?: string
  // For a wallet that signs on the request's chain: skips the chain check and estimates against the
  // source chain, since the wallet's own node may be on another one.
  estimateGasOnSource?: (transaction: WalletTransaction) => Promise<bigint>
}): Promise<PreparedWalletRequest> {
  const { provider, sender, chainId, to, data, value, gasLimit, estimateGasOnSource } = params
  const [accounts, walletChainId] = await Promise.all([
    provider.request({ method: "eth_accounts" }),
    estimateGasOnSource ? chainId : provider.request({ method: "eth_chainId" }),
  ])
  if (!Array.isArray(accounts) || typeof accounts[0] !== "string") {
    throw new Error("Wallet not connected")
  }
  if (accounts[0].toLowerCase() !== sender.toLowerCase()) {
    throw new Error("Your wallet switched accounts. Try again.")
  }
  if (!estimateGasOnSource && parseChainId(walletChainId) !== BigInt(chainId)) {
    return { status: "wrong_chain", provider }
  }
  const transaction: WalletTransaction = {
    chainId: hexQuantity(chainId),
    from: sender,
    to,
    data,
    value: hexQuantity(value),
  }
  const gas = gasLimit
    ? hexQuantity(gasLimit)
    : estimateGasOnSource
      ? hexQuantity((await estimateGasOnSource(transaction)).toString())
      : parseHexQuantity(
          await provider.request({ method: "eth_estimateGas", params: [transaction] }),
        )
  return { status: "ready", provider, transaction: { ...transaction, gas } }
}

export function sendPreparedWalletRequest(
  request: Extract<PreparedWalletRequest, { status: "ready" }>,
) {
  try {
    return request.provider.request({
      method: "eth_sendTransaction",
      params: [request.transaction],
    })
  } catch (error) {
    return Promise.reject(error)
  }
}
