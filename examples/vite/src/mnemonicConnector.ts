import { createConnector } from "wagmi"
import { privateKeyToAccount } from "viem/accounts"
import { HDKey } from "@scure/bip32"
import * as bip39 from "@scure/bip39"
import { wordlist } from "@scure/bip39/wordlists/english"

function mnemonicToPrivateKey(mnemonic: string, index = 0): `0x${string}` {
  const seed = bip39.mnemonicToSeedSync(mnemonic)
  const hdKey = HDKey.fromMasterSeed(seed)
  const derivationPath = `m/44'/60'/0'/0/${index}`
  const childKey = hdKey.derive(derivationPath)

  if (!childKey.privateKey) {
    throw new Error("Failed to derive private key")
  }

  return `0x${Array.from(childKey.privateKey)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")}`
}

export const mnemonicWalletConnector = createConnector((config) => ({
  id: "mnemonic-wallet",
  name: "Test Wallet (Mnemonic)",
  type: "injected",

  async getAccounts() {
    const mnemonic = import.meta.env.INITIA_TEST_MNEMONIC

    if (!mnemonic) {
      return []
    }

    const privateKey = mnemonicToPrivateKey(mnemonic)
    const account = privateKeyToAccount(privateKey)

    return [account.address]
  },

  async connect() {
    const mnemonic = import.meta.env.INITIA_TEST_MNEMONIC

    if (!mnemonic) {
      throw new Error("INITIA_TEST_MNEMONIC environment variable is not set")
    }

    if (!bip39.validateMnemonic(mnemonic, wordlist)) {
      throw new Error("Invalid mnemonic phrase")
    }

    const privateKey = mnemonicToPrivateKey(mnemonic)
    const account = privateKeyToAccount(privateKey)
    const chainId = config.chains[0].id

    return {
      accounts: [account.address],
      chainId,
    }
  },

  async disconnect() {
    return
  },

  async getAccount() {
    const mnemonic = import.meta.env.INITIA_TEST_MNEMONIC

    if (!mnemonic) {
      throw new Error("INITIA_TEST_MNEMONIC environment variable is not set")
    }

    const privateKey = mnemonicToPrivateKey(mnemonic)
    const account = privateKeyToAccount(privateKey)

    return account.address
  },

  async getChainId() {
    return config.chains[0].id
  },

  async isAuthorized() {
    const mnemonic = import.meta.env.INITIA_TEST_MNEMONIC
    return !!mnemonic
  },

  onAccountsChanged() {
    return () => {}
  },

  onChainChanged() {
    return () => {}
  },

  onDisconnect() {
    return () => {}
  },

  async getProvider() {
    const mnemonic = import.meta.env.INITIA_TEST_MNEMONIC

    if (!mnemonic) {
      throw new Error("INITIA_TEST_MNEMONIC environment variable is not set")
    }

    const privateKey = mnemonicToPrivateKey(mnemonic)
    const account = privateKeyToAccount(privateKey)

    return {
      request: async ({ method, params }: { method: string; params?: unknown[] }) => {
        switch (method) {
          case "eth_accounts":
            return [account.address]
          case "eth_requestAccounts":
            return [account.address]
          case "eth_chainId":
            return `0x${config.chains[0].id.toString(16)}`
          case "personal_sign":
            return account.signMessage({
              message: params?.[0] as string,
            })
          case "eth_signTypedData_v4":
            return account.signTypedData(JSON.parse(params?.[1] as string))
          default:
            throw new Error(`Method ${method} not supported`)
        }
      },
    }
  },
}))
