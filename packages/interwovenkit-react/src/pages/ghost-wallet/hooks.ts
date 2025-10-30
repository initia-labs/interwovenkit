import type { StdFee } from "@cosmjs/amino"
import type { EncodeObject } from "@cosmjs/proto-signing"
import { useEffect, useMemo, useState } from "react"
import { atom, useAtom, useAtomValue, useSetAtom } from "jotai"
import { useQueryClient } from "@tanstack/react-query"
import { MsgExec } from "@initia/initia.proto/cosmos/authz/v1beta1/tx"
import type { TxRaw } from "@initia/initia.proto/cosmos/tx/v1beta1/tx"
import { InitiaAddress } from "@initia/utils"
import { useBackend } from "@/data/api"
import { useDefaultChain, useFindChain } from "@/data/chains"
import { useConfig } from "@/data/config"
import { OfflineSigner, useRegistry, useSignWithEthSecp256k1 } from "@/data/signer"
import { useTx } from "@/data/tx"
import { useInitiaAddress } from "@/public/data/hooks"
import { checkGhostWalletEnabled, ghostWalletQueryKeys } from "./queries"
import { canGhostWalletHandleTxRequest, getPageInfo } from "./utils"

export function useEmbeddedWallet() {
  const { privy } = useConfig()
  return privy?.wallets.find((w) => w.connectorType === "embedded")
}

export function useEmbeddedWalletAddress() {
  const wallet = useEmbeddedWallet()
  return wallet?.address ? InitiaAddress(wallet.address).bech32 : undefined
}

function parseChainTypeToMsg(type?: string) {
  switch (type) {
    case "minievm":
      return "/minievm.evm.v1.MsgCall"
    case "minimove":
      return "/initia.move.v1.MsgExecute"
    case "miniwasm":
      return "/cosmwasm.wasm.v1.MsgExecuteContract"
    default:
      return null
  }
}

export function useAutoSignPermissions() {
  const { enableAutoSign } = useConfig()
  const defaultChain = useDefaultChain()

  if (!enableAutoSign) return {}

  if (enableAutoSign === true) {
    const msgType = parseChainTypeToMsg(defaultChain.metadata?.minitia?.type)
    if (!msgType) return {}

    return {
      [defaultChain.chainId]: [msgType],
    }
  }

  return enableAutoSign
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
  const [expirations, setExpirations] = useAtom(ghostWalletExpirationAtom)
  const setLoading = useSetAtom(ghostWalletLoadingAtom)
  const address = useInitiaAddress()
  const findChain = useFindChain()
  const embeddedWalletAddress = useEmbeddedWalletAddress()
  const autoSignPermissions = useAutoSignPermissions()

  const checkGhostWallet = async (): Promise<Record<string, boolean>> => {
    if (!embeddedWalletAddress || !address || !autoSignPermissions) {
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
        Object.entries(autoSignPermissions).map(
          async ([chainId, permission]) =>
            [
              chainId,
              await checkGhostWalletEnabled(
                address,
                embeddedWalletAddress,
                permission,
                findChain(chainId).restUrl,
              ),
            ] as [string, { enabled: boolean; expiresAt?: number }],
        ),
      )

      setExpirations(
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
    expirations,
    isEnabled,
    checkGhostWallet,
  }
}

export const ghostWalletExpirationAtom = atom<Record<string, number | undefined>>({})
export const ghostWalletLoadingAtom = atom<boolean>(true)

export function useIsGhostWalletEnabled() {
  const expirations = useAtomValue(ghostWalletExpirationAtom)
  const [tick, setTick] = useState(0)

  const isEnabled = useMemo(
    () => parseExpirationTimes(expirations),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- tick is used to force re-evaluation when expiration timer fires
    [expirations, tick],
  )

  useEffect(() => {
    const expiration = getEarliestExpiration(expirations)
    if (!expiration) return

    // Set up timer to disable when expiration is reached
    const timeoutId = setTimeout(() => {
      setTick((t) => t + 1)
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
  const ghostWalletState = useGhostWalletState()
  const signWithGhostWallet = useSignWithGhostWallet()
  const autoSignPermissions = useAutoSignPermissions()

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
  const granteeAddress = useEmbeddedWalletAddress()
  const { getAuthClient } = useBackend()

  const { icon } = getPageInfo()

  return async () => {
    const client = await getAuthClient()

    // Send POST request to register the domain
    await client
      .post("auto-sign/register", {
        json: {
          granteeAddress,
          icon,
          domain: window.location.origin,
        },
      })
      .catch(() => {})
  }
}

export function useRevokeAutoSign() {
  const queryClient = useQueryClient()
  const granteeAddress = useEmbeddedWalletAddress()
  const initiaAddress = useInitiaAddress()
  const permissions = useAutoSignPermissions()
  const ghostWalletState = useGhostWalletState()
  const setGhostWalletExpiration = useSetAtom(ghostWalletExpirationAtom)
  const { requestTxBlock } = useTx()

  return async (chainId: string) => {
    if (!permissions[chainId]) throw new Error("No auto sign permissions found for this chain")
    if (!ghostWalletState.isEnabled[chainId])
      throw new Error("Ghost wallet is not enabled for this chain")

    await requestTxBlock({
      messages: [
        {
          typeUrl: "/cosmos.feegrant.v1beta1.MsgRevokeAllowance",
          value: {
            granter: initiaAddress,
            grantee: granteeAddress,
          },
        },
        ...permissions[chainId].map((msg) => ({
          typeUrl: "/cosmos.authz.v1beta1.MsgRevoke",
          value: {
            granter: initiaAddress,
            grantee: granteeAddress!,
            msgTypeUrl: msg,
          },
        })),
      ],
      chainId,
    })

    // Invalidate the grants query to refresh the data
    queryClient.invalidateQueries({
      queryKey: ghostWalletQueryKeys.grantsByGranter._def,
    })

    setGhostWalletExpiration((exp) => ({ ...exp, [chainId]: undefined }))
  }
}
