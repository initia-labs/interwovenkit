import { mnemonicToAccount } from "viem/accounts"

const mnemonic = import.meta.env.INITIA_TEST_MNEMONIC
if (mnemonic) {
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

  const info = {
    uuid: "test-wallet-e2e-0000",
    name: "Test Wallet",
    icon: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' width='32' height='32'><rect width='32' height='32' rx='6' fill='%234f46e5'/><text x='16' y='22' text-anchor='middle' fill='white' font-size='18' font-family='system-ui'>T</text></svg>" as const,
    rdns: "com.test.wallet",
  }

  const detail = Object.freeze({ info, provider })

  window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail }))
  window.addEventListener("eip6963:requestProvider", () => {
    window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail }))
  })
}
