import type { StdFee } from "@cosmjs/amino"
import type { EncodeObject } from "@cosmjs/proto-signing"
import { useSignMessage } from "wagmi"
import { useCallback, useEffect, useRef } from "react"
import { MsgExec } from "@initia/initia.proto/cosmos/authz/v1beta1/tx"
import type { TxRaw } from "@initia/initia.proto/cosmos/tx/v1beta1/tx"
import { InitiaAddress } from "@initia/utils"
import { useDefaultChain } from "@/data/chains"
import { useConfig } from "@/data/config"
import { OfflineSigner, useRegistry, useSignWithEthSecp256k1 } from "@/data/signer"
import { useHexAddress, useInitiaAddress } from "@/public/data/hooks"

export function useSetupEmbeddedWallet() {
  const { privyContext } = useConfig()
  const address = useHexAddress()
  const { signMessageAsync } = useSignMessage()

  // Use a ref to always have access to the latest privyContext
  const privyContextRef = useRef(privyContext)

  // Update ref in an effect to avoid updating during render
  useEffect(() => {
    privyContextRef.current = privyContext
  }, [privyContext])

  // Helper function to wait for authentication state changes
  const waitForAuthState = useCallback(
    async (targetState: boolean, timeoutMs: number = 3000): Promise<void> => {
      const startTime = Date.now()
      while (
        privyContextRef.current?.privy.authenticated !== targetState &&
        Date.now() - startTime < timeoutMs
      ) {
        await new Promise((resolve) => setTimeout(resolve, 100))
      }

      if (privyContextRef.current?.privy.authenticated !== targetState) {
        throw new Error(
          `Failed to reach authentication state: ${targetState ? "authenticated" : "logged out"}`,
        )
      }
    },
    [],
  )

  return useCallback(async () => {
    if (!privyContextRef.current) throw new Error("privy context not available")

    // Check if embedded wallet already exists for current user
    const currentEmbeddedWallet = privyContextRef.current.wallets.find(
      (wallet) => wallet.connectorType === "embedded",
    )
    const currentUserAddress = privyContextRef.current.privy.user?.wallet?.address

    if (
      currentEmbeddedWallet &&
      currentUserAddress &&
      InitiaAddress(currentUserAddress).hex === address
    ) {
      return currentEmbeddedWallet
    }

    if (privyContextRef.current.privy.authenticated) {
      await privyContextRef.current.privy.logout()

      // Wait for logout to complete
      await waitForAuthState(false)
    }

    const message = await privyContextRef.current.siwe.generateSiweMessage({
      chainId: "eip155:1",
      address,
    })
    if (!message) throw new Error("unable to create siwe message")
    const signature = await signMessageAsync({ message })

    await privyContextRef.current.siwe.loginWithSiwe({ signature, message })

    // Wait for authentication to complete and state to update
    await waitForAuthState(true)

    // Check for embedded wallet or create one
    const embeddedWallet = privyContextRef.current.wallets.find(
      (wallet) => wallet.connectorType === "embedded",
    )
    if (embeddedWallet) return embeddedWallet

    // Create wallet if it doesn't exist
    return await privyContextRef.current.createWallet({ createAdditional: false })
  }, [address, signMessageAsync, waitForAuthState])
}

/* Retrieve embedded wallet instance from Privy context for auto-sign delegation */
export function useEmbeddedWallet() {
  const { privyContext } = useConfig()
  const address = useInitiaAddress()
  const userAddress = privyContext?.privy.user?.wallet?.address

  if (!userAddress || InitiaAddress(userAddress).bech32 !== address) return undefined

  return privyContext?.wallets.find((wallet) => wallet.connectorType === "embedded")
}

/* Extract embedded wallet address and convert to Initia Bech32 format */
export function useEmbeddedWalletAddress() {
  const wallet = useEmbeddedWallet()
  return wallet?.address ? InitiaAddress(wallet.address).bech32 : undefined
}

/* Sign auto-sign transactions with embedded wallet by wrapping messages in MsgExec and delegating fees */
export function useSignWithEmbeddedWallet() {
  const embeddedWallet = useEmbeddedWallet()
  const embeddedWalletAddress = useEmbeddedWalletAddress()
  const registry = useRegistry()
  const defaultChain = useDefaultChain()
  const signWithEthSecp256k1 = useSignWithEthSecp256k1()

  return async (
    chainId: string,
    address: string,
    messages: EncodeObject[],
    fee: StdFee,
    memo: string,
  ): Promise<TxRaw> => {
    if (!embeddedWallet || !embeddedWalletAddress) {
      throw new Error("Embedded wallet not initialized")
    }

    // Wrap messages in MsgExec for authz delegation
    const authzExecuteMessage: EncodeObject[] = [
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

    // Set fee granter for delegated transaction
    const delegatedFee: StdFee = {
      ...fee,
      granter: address,
    }

    // Create signer instance for delegate wallet
    const delegateSigner = new OfflineSigner(
      embeddedWalletAddress,
      embeddedWallet.sign,
      defaultChain.restUrl,
    )

    // Sign transaction with delegate wallet
    return await signWithEthSecp256k1(
      chainId,
      embeddedWalletAddress,
      authzExecuteMessage,
      delegatedFee,
      memo,
      { customSigner: delegateSigner },
    )
  }
}
