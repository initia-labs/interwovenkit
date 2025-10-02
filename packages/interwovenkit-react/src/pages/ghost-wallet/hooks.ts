import type { EncodeObject } from "@cosmjs/proto-signing"
import type { StdFee } from "@cosmjs/amino"
import { atom, useAtomValue, useSetAtom } from "jotai"
import { useEffect, useState } from "react"
import { InitiaAddress } from "@initia/utils"
import { useConfig } from "@/data/config"
import { useDefaultChain } from "@/data/chains"
import { checkGhostWalletEnabled } from "./queries"
import { OfflineSigner, useSignWithEthSecp256k1, useRegistry } from "@/data/signer"
import { useInitiaAddress } from "@/public/data/hooks"
import type { TxRaw } from "@initia/initia.proto/cosmos/tx/v1beta1/tx"
import { MsgExec } from "@initia/initia.proto/cosmos/authz/v1beta1/tx"

export function useEmbeddedWalletAddress() {
  const wallet = useEmbeddedWallet()

  return wallet?.address ? InitiaAddress(wallet.address).bech32 : undefined
}

export function useEmbeddedWallet() {
  const { privyHooks } = useConfig()
  return privyHooks?.wallets.find((w) => w.connectorType === "embedded")
}

export function useSignWithGhostWallet() {
  const embeddedWallet = useEmbeddedWallet()
  const embeddedWalletAddress = useEmbeddedWalletAddress()
  const signWithEthSecp256k1 = useSignWithEthSecp256k1()
  const userAddress = useInitiaAddress()
  const registry = useRegistry()

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
      // calculate fee
      gas: "1000000", // default gas if not provided
      amount:
        fee.amount.length > 0
          ? fee.amount
          : [{ denom: "uinit", amount: (1000000 * 0.015).toFixed(0) }], // default amount if not provided
    }

    // Create a custom signer for the embedded wallet using ethers
    const embeddedSigner = new OfflineSigner(embeddedWalletAddress, embeddedWallet.sign)

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
  const address = useInitiaAddress()
  const config = useConfig()
  const defaultChain = useDefaultChain()
  const embeddedWalletAddress = useEmbeddedWalletAddress()

  const checkGhostWallet = async (): Promise<Record<string, boolean>> => {
    if (!embeddedWalletAddress || !address) return {}

    const permissions = config.ghostWalletPermissions || []
    if (!permissions.length) return {}

    // If already enabled and not expired, return true
    if (Object.values(isEnabled).some((v) => v)) return isEnabled

    // Perform the actual check
    const result = await Promise.all(
      Object.entries(permissions).map(
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
  }

  return {
    isEnabled,
    checkGhostWallet,
  }
}

export const ghostWalletExpirationAtom = atom<Record<string, number | undefined>>({})

export function useIsGhostWalletEnabled() {
  const expirations = useAtomValue(ghostWalletExpirationAtom)
  const [isEnabled, setIsEnabled] = useState(parseExpirationTimes(expirations))

  useEffect(() => {
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
