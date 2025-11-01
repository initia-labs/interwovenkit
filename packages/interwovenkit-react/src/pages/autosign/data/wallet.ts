import type { StdFee } from "@cosmjs/amino"
import type { EncodeObject } from "@cosmjs/proto-signing"
import { MsgExec } from "@initia/initia.proto/cosmos/authz/v1beta1/tx"
import type { TxRaw } from "@initia/initia.proto/cosmos/tx/v1beta1/tx"
import { InitiaAddress } from "@initia/utils"
import { useDefaultChain } from "@/data/chains"
import { useConfig } from "@/data/config"
import { OfflineSigner, useRegistry, useSignWithEthSecp256k1 } from "@/data/signer"
import { useInitiaAddress } from "@/public/data/hooks"

export function useEmbeddedWallet() {
  const { privy } = useConfig()
  return privy?.wallets.find((w) => w.connectorType === "embedded")
}

export function useEmbeddedWalletAddress() {
  const wallet = useEmbeddedWallet()
  return wallet?.address ? InitiaAddress(wallet.address).bech32 : undefined
}

export function useSignWithEmbeddedWallet() {
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
      throw new Error("Embedded wallet not available")
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
