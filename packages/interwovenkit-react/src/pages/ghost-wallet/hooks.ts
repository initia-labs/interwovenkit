import type { StdFee } from "@cosmjs/amino"
import { toBase64, toUtf8 } from "@cosmjs/encoding"
import type { EncodeObject } from "@cosmjs/proto-signing"
import ky from "ky"
import { useEffect, useState } from "react"
import { atom, useAtomValue, useSetAtom } from "jotai"
import { MsgExec } from "@initia/initia.proto/cosmos/authz/v1beta1/tx"
import type { TxRaw } from "@initia/initia.proto/cosmos/tx/v1beta1/tx"
import { InitiaAddress } from "@initia/utils"
import { useDefaultChain } from "@/data/chains"
import { useConfig } from "@/data/config"
import { OfflineSigner, useRegistry, useSignWithEthSecp256k1 } from "@/data/signer"
import { useInitiaAddress } from "@/public/data/hooks"
import { INTERWOVENKIT_API_URL } from "./constants"
import { checkGhostWalletEnabled } from "./queries"
import { canGhostWalletHandleTxRequest, getPageInfo } from "./utils"

export function useEmbeddedWallet() {
  const { privy } = useConfig()
  return privy?.wallets.find((w) => w.connectorType === "embedded")
}

export function useEmbeddedWalletAddress() {
  const wallet = useEmbeddedWallet()
  return wallet?.address ? InitiaAddress(wallet.address).bech32 : undefined
}

export function useSignWithGhostWallet() {
  const embeddedWallet = useEmbeddedWallet()
  const embeddedWalletAddress = useEmbeddedWalletAddress()
  const signWithEthSecp256k1 = useSignWithEthSecp256k1()
  const userAddress = useInitiaAddress()
  const registry = useRegistry()
  const defaultChain = useDefaultChain()

  return async (
    chainId: string,
    messages: EncodeObject[],
    fee: StdFee,
    memo: string,
  ): Promise<TxRaw> => {
    if (!embeddedWallet || !embeddedWalletAddress) {
      throw new Error("Ghost wallet not available")
    }

    // Wrap all messages in a MsgExec for authz execution
    const wrappedMessages: EncodeObject[] = [
      {
        typeUrl: "/cosmos.authz.v1beta1.MsgExec",
        value: MsgExec.fromPartial({
          grantee: embeddedWalletAddress,
          msgs: messages.map((msg) => ({
            typeUrl: msg.typeUrl,
            value: registry.encode(msg),
          })),
        }),
      },
    ]

    // Modify the fee to set the granter as the user's main wallet
    const feeWithGranter: StdFee = {
      ...fee,
      granter: userAddress,
    }

    // Create a custom signer for the embedded wallet using ethers
    const embeddedSigner = new OfflineSigner(
      embeddedWalletAddress,
      embeddedWallet.sign,
      defaultChain.restUrl,
    )

    // Use the existing signing function but with the embedded wallet signer
    return await signWithEthSecp256k1(
      chainId,
      embeddedWalletAddress,
      wrappedMessages,
      feeWithGranter,
      memo,
      { customSigner: embeddedSigner },
    )
  }
}

export function useGhostWalletState() {
  const isEnabled = useIsGhostWalletEnabled()
  const setExpiration = useSetAtom(ghostWalletExpirationAtom)
  const setLoading = useSetAtom(ghostWalletLoadingAtom)
  const address = useInitiaAddress()
  const config = useConfig()
  const defaultChain = useDefaultChain()
  const embeddedWalletAddress = useEmbeddedWalletAddress()

  const checkGhostWallet = async (): Promise<Record<string, boolean>> => {
    if (!embeddedWalletAddress || !address || !config.autoSignPermissions) {
      setLoading(false)
      return {}
    }

    // If already enabled and not expired, return true
    if (Object.values(isEnabled).some((v) => v)) {
      setLoading(false)
      return isEnabled
    }

    try {
      // Perform the actual check
      const result = await Promise.all(
        Object.entries(config.autoSignPermissions).map(
          async ([chainId, permission]) =>
            [
              chainId,
              await checkGhostWalletEnabled(
                address,
                embeddedWalletAddress,
                permission,
                defaultChain.restUrl,
              ),
            ] as [string, { enabled: boolean; expiresAt?: number }],
        ),
      )

      setExpiration(
        Object.fromEntries(
          result.map(([chainId, res]) => [chainId, res.enabled ? res.expiresAt : undefined]),
        ),
      )

      return Object.fromEntries(result.map(([chainId, res]) => [chainId, res.enabled]))
    } finally {
      setLoading(false)
    }
  }

  return {
    isEnabled,
    checkGhostWallet,
  }
}

export const ghostWalletExpirationAtom = atom<Record<string, number | undefined>>({})
export const ghostWalletLoadingAtom = atom<boolean>(true)

export function useIsGhostWalletEnabled() {
  const expirations = useAtomValue(ghostWalletExpirationAtom)
  const [isEnabled, setIsEnabled] = useState(parseExpirationTimes(expirations))

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsEnabled(parseExpirationTimes(expirations))

    const expiration = getEarliestExpiration(expirations)
    if (!expiration) return

    // Set up timer to disable when expiration is reached
    const timeoutId = setTimeout(() => {
      setIsEnabled(parseExpirationTimes(expirations))
    }, expiration - Date.now())

    return () => clearTimeout(timeoutId)
  }, [expirations])

  return isEnabled
}

/* utils */
function parseExpirationTimes(expirations: Record<string, number | undefined>) {
  return Object.fromEntries(
    Object.entries(expirations).map(([chainId, expirationTime]) => {
      return [chainId, !!expirationTime && expirationTime > Date.now()]
    }),
  )
}

function getEarliestExpiration(expirations: Record<string, number | undefined>) {
  const validExpirations = Object.values(expirations).filter(
    (expiration) => !!expiration && expiration > Date.now(),
  ) as number[]

  if (validExpirations.length === 0) return undefined
  return Math.min(...validExpirations)
}

/**
 * Hook that returns a simplified trySignWithGhostWallet function
 * with all ghost wallet dependencies already injected.
 */
export function useTrySignWithGhostWallet() {
  const config = useConfig()
  const ghostWalletState = useGhostWalletState()
  const signWithGhostWallet = useSignWithGhostWallet()
  const autoSignPermissions = config.autoSignPermissions

  return async (
    chainId: string,
    messages: EncodeObject[],
    fee: StdFee,
    memo: string,
  ): Promise<TxRaw | null> => {
    // Check if ghost wallet can handle this transaction type
    if (!canGhostWalletHandleTxRequest({ messages, chainId }, autoSignPermissions)) {
      return null
    }

    // Check if ghost wallet is enabled for this chain
    const isGhostWalletEnabled = await ghostWalletState.checkGhostWallet()
    if (!isGhostWalletEnabled[chainId]) {
      return null
    }

    // Sign with ghost wallet
    return await signWithGhostWallet(chainId, messages, fee, memo)
  }
}

/**
 * Hook that returns a function to register a ghost wallet with a site
 */
export function useRegisterGhostWallet() {
  const address = useInitiaAddress()
  const wallet = useEmbeddedWallet()
  const granterAddress = useEmbeddedWalletAddress()

  const { icon } = getPageInfo()

  return async () => {
    if (!address || !wallet) {
      throw new Error("Wallet not connected")
    }

    const message = toBase64(
      toUtf8(
        JSON.stringify({
          address,
          granterAddress,
          domainAddress: window.location.hostname,
          createdAt: Date.now(),
          metadata: {
            icon,
          },
        }),
      ),
    )

    const signature = await wallet.sign(message)

    try {
      // Send POST request to register the domain
      await ky.post("auto-signing/register", {
        prefixUrl: INTERWOVENKIT_API_URL,
        json: {
          signature,
          message,
        },
      })
    } catch {} // eslint-disable-line no-empty
  }
}
