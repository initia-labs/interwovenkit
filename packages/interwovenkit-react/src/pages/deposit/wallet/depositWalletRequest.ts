export interface DepositWalletProvider {
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
}): Promise<PreparedWalletRequest> {
  const { provider, sender, chainId, to, data, value, gasLimit } = params
  const [accounts, walletChainId] = await Promise.all([
    provider.request({ method: "eth_accounts" }),
    provider.request({ method: "eth_chainId" }),
  ])
  if (!Array.isArray(accounts) || typeof accounts[0] !== "string") {
    throw new Error("Wallet not connected")
  }
  if (accounts[0].toLowerCase() !== sender.toLowerCase()) {
    throw new Error("Your wallet switched accounts. Try again.")
  }
  if (parseChainId(walletChainId) !== BigInt(chainId)) {
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
    : parseHexQuantity(await provider.request({ method: "eth_estimateGas", params: [transaction] }))
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
