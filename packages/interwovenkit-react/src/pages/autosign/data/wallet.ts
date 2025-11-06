import type { StdFee } from "@cosmjs/amino"
import type { EncodeObject } from "@cosmjs/proto-signing"
import { MsgExec } from "@initia/initia.proto/cosmos/authz/v1beta1/tx"
import type { TxRaw } from "@initia/initia.proto/cosmos/tx/v1beta1/tx"
import { InitiaAddress } from "@initia/utils"
import { useDefaultChain } from "@/data/chains"
import { useConfig } from "@/data/config"
import { OfflineSigner, useRegistry, useSignWithEthSecp256k1 } from "@/data/signer"

/* Retrieve embedded wallet instance from Privy context for auto-sign delegation */
export function useEmbeddedWallet() {
  const { privyContext } = useConfig()
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
