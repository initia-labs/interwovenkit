import { mnemonicToAccount } from "viem/accounts"
import { injected } from "wagmi/connectors"

const mnemonic = import.meta.env.INITIA_TEST_MNEMONIC

function createTestWalletConnector() {
  if (!mnemonic) return null

  const account = mnemonicToAccount(mnemonic)
  const chainId = 1

  type Listener = (...args: unknown[]) => void
  const listeners: Record<string, Set<Listener>> = {}

  const provider = {
    request: async ({ method, params }: { method: string; params?: unknown[] }) => {
      switch (method) {
        case "eth_requestAccounts":
        case "eth_accounts":
          return [account.address]
        case "eth_chainId":
          return `0x${chainId.toString(16)}`
        case "personal_sign": {
          const [message] = params as [string]
          return account.signMessage({ message: { raw: message as `0x${string}` } })
        }
        default:
          throw new Error(`Test wallet: unsupported method ${method}`)
      }
    },
    on: (event: string, fn: Listener) => {
      ;(listeners[event] ??= new Set()).add(fn)
    },
    removeListener: (event: string, fn: Listener) => {
      listeners[event]?.delete(fn)
    },
  }

  return injected({
    target: () => ({
      id: "testWallet",
      name: "Test Wallet",
      provider: provider as never,
    }),
  })
}

export const testWalletConnector = createTestWalletConnector()
