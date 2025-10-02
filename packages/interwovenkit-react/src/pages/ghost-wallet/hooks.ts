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

export const ghostWalletExpirationAtom = atom<number | undefined>(undefined)

function useIsGhostWalletEnabled() {
  const expiration = useAtomValue(ghostWalletExpirationAtom)
  const [isEnabled, setIsEnabled] = useState(expiration !== undefined && expiration >= Date.now())

  useEffect(() => {
    if (expiration === undefined) {
      setIsEnabled(false)
      return
    }

    // Initial check
    const currentTime = Date.now()
    if (currentTime >= expiration) {
      setIsEnabled(false)
      return
    }

    setIsEnabled(true)

    // Set up timer to disable when expiration is reached
    const timeUntilExpiration = expiration - currentTime
    const timeoutId = setTimeout(() => {
      setIsEnabled(false)
    }, timeUntilExpiration)

    return () => clearTimeout(timeoutId)
  }, [expiration])

  return isEnabled
}

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

  const checkGhostWallet = async (): Promise<boolean> => {
    if (!embeddedWalletAddress || !address) return false

    const permissions = config.ghostWalletPermissions || []
    if (!permissions.length) return false

    // If already enabled and not expired, return true
    if (isEnabled) return true

    // Perform the actual check
    const result = await checkGhostWalletEnabled(
      address,
      embeddedWalletAddress,
      permissions,
      defaultChain.restUrl,
    )

    // Update expiration based on actual grant expiration
    if (result.enabled) {
      setExpiration(result.expiresAt)
    } else {
      setExpiration(undefined)
    }

    return result.enabled
  }

  return {
    isEnabled,
    checkGhostWallet,
  }
}
