import { useWallets } from "@privy-io/react-auth"
import { useQuery } from "@tanstack/react-query"
import { InitiaAddress } from "@initia/utils"
import type { EncodeObject } from "@cosmjs/proto-signing"
import type { StdFee } from "@cosmjs/amino"
import { useConfig } from "@/data/config"
import { useIsGhostWalletEnabled } from "./queries"
import { OfflineSigner, useSignWithEthSecp256k1, useRegistry } from "@/data/signer"
import { useInitiaAddress } from "@/public/data/hooks"
import type { TxRaw } from "@initia/initia.proto/cosmos/tx/v1beta1/tx"
import { MsgExec } from "@initia/initia.proto/cosmos/authz/v1beta1/tx"

export function useEmbeddedWalletAddress() {
  const { wallets } = useWallets()
  const embeddedWallet = wallets.find((w) => w.connectorType === "embedded")
  return embeddedWallet?.address ? InitiaAddress(embeddedWallet.address).bech32 : undefined
}

export function useEmbeddedWallet() {
  const { wallets } = useWallets()
  return wallets.find((w) => w.connectorType === "embedded")
}

export function useCanGhostWalletHandleTx() {
  const config = useConfig()
  const ghostWalletEnabledQuery = useQuery(useIsGhostWalletEnabled())

  return (messages: EncodeObject[]) => {
    // Check if ghost wallet is enabled
    if (!ghostWalletEnabledQuery.data) {
      return false
    }

    // Check if all message types are allowed by ghost wallet permissions
    const allowedMessageTypes = config.ghostWalletPermissions || []

    return messages.every((message) => allowedMessageTypes.includes(message.typeUrl))
  }
}

export function useSignWithGhostWallet() {
  const embeddedWallet = useEmbeddedWallet()
  const signWithEthSecp256k1 = useSignWithEthSecp256k1()
  const userAddress = useInitiaAddress()
  const registry = useRegistry()

  return async (
    chainId: string,
    messages: EncodeObject[],
    fee: StdFee,
    memo: string,
  ): Promise<TxRaw> => {
    if (!embeddedWallet?.address) {
      throw new Error("Ghost wallet not available")
    }

    const ghostWalletAddress = InitiaAddress(embeddedWallet.address).bech32

    // Wrap all messages in a MsgExec for authz execution
    const wrappedMessages: EncodeObject[] = [
      {
        typeUrl: "/cosmos.authz.v1beta1.MsgExec",
        value: MsgExec.fromPartial({
          grantee: ghostWalletAddress,
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

    // Create a custom signer for the embedded wallet
    const embeddedSigner = new OfflineSigner(ghostWalletAddress, async (message: string) => {
      return await embeddedWallet.sign(message)
    })

    // Use the existing signing function but with the embedded wallet signer
    return await signWithEthSecp256k1(
      chainId,
      ghostWalletAddress,
      wrappedMessages,
      feeWithGranter,
      memo,
      embeddedSigner,
    )
  }
}
