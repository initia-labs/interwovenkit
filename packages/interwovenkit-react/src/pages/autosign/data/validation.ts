import type { EncodeObject } from "@cosmjs/proto-signing"
import { isPast } from "date-fns"
import ky from "ky"
import { useEffect } from "react"
import { atom, useAtom, useSetAtom } from "jotai"
import { useDefaultChain, useFindChain } from "@/data/chains"
import { useConfig } from "@/data/config"
import type { TxRequest } from "@/data/tx"
import { useInitiaAddress } from "@/public/data/hooks"
import { useEmbeddedWalletAddress } from "./wallet"

/**
 * Maps a chain type to its corresponding Cosmos message type URL.
 * Determines the appropriate message type for transaction execution based on the chain's VM type.
 */
function mapChainTypeToMessageType(chainType?: string) {
  switch (chainType) {
    case "minievm":
      return "/minievm.evm.v1.MsgCall"
    case "miniwasm":
      return "/cosmwasm.wasm.v1.MsgExecuteContract"
    default:
      return "/initia.move.v1.MsgExecute"
  }
}

/**
 * Hook that retrieves auto-sign permissions configuration for each chain.
 * Returns a mapping of chain IDs to allowed message types based on the app configuration.
 * Handles both boolean and detailed permission configurations, automatically determining
 * message types based on chain characteristics when using boolean config.
 */
export function useAutoSignPermissions() {
  const { enableAutoSign } = useConfig()
  const defaultChain = useDefaultChain()

  if (!enableAutoSign) {
    return {}
  }

  if (typeof enableAutoSign === "boolean" && enableAutoSign) {
    const messageType = mapChainTypeToMessageType(defaultChain.metadata?.minitia?.type)
    return { [defaultChain.chainId]: [messageType] }
  }

  return enableAutoSign
}

/**
 * Hook that initializes auto-sign state when the component mounts.
 * Automatically checks and updates auto-sign status whenever the main wallet address
 * or embedded wallet address changes. Ensures auto-sign state is synchronized
 * with the current wallet configuration.
 */
export function useInitializeAutoSign() {
  const autoSignState = useAutoSignState()
  const address = useInitiaAddress()
  const embeddedWalletAddress = useEmbeddedWalletAddress()

  useEffect(() => {
    if (!embeddedWalletAddress || !address) return
    autoSignState.checkAutoSign()
    // we want to run this effect only when address or embeddedWalletAddress changes since these are the only two
    // variables that affect the auto sign state on startup
  }, [address, embeddedWalletAddress]) // eslint-disable-line react-hooks/exhaustive-deps
}

export const autoSignExpirationAtom = atom<Record<string, number | null>>({})
export const autoSignLoadingAtom = atom<boolean>(true)

/**
 * Hook that manages the complete auto-sign state including enabled status and expiration times.
 * Provides functionality to check auto-sign permissions across multiple chains and tracks their expiration.
 * Handles loading states and caches enabled status to avoid redundant API calls.
 */
export function useAutoSignState() {
  const [expirations, setExpirations] = useAtom(autoSignExpirationAtom)
  const setLoading = useSetAtom(autoSignLoadingAtom)
  const address = useInitiaAddress()
  const findChain = useFindChain()
  const embeddedWalletAddress = useEmbeddedWalletAddress()
  const autoSignPermissions = useAutoSignPermissions()

  const checkAutoSign = async (): Promise<Record<string, boolean>> => {
    if (!embeddedWalletAddress || !address || !autoSignPermissions) {
      setLoading(false)
      return {}
    }

    // If already enabled and not expired, return true
    if (Object.values(expirations).some((v) => v && isPast(new Date(v)))) {
      setLoading(false)
      return parseExpirationTimes(expirations)
    }

    try {
      const results = await Promise.all(
        Object.entries(autoSignPermissions).map(async ([chainId, permission]) => {
          const { restUrl } = findChain(chainId)
          const result = await checkAutoSignExpiration(
            address,
            embeddedWalletAddress,
            permission,
            restUrl,
          )
          return [chainId, result] as const
        }),
      )

      setExpirations(Object.fromEntries(results.map(([chainId, result]) => [chainId, result])))

      return Object.fromEntries(results.map(([chainId, result]) => [chainId, !!result]))
    } finally {
      setLoading(false)
    }
  }

  return { expirations, checkAutoSign }
}

/**
 * Checks if auto-sign is enabled for a specific grantee by verifying both feegrant and authz grants.
 * Validates that all required permissions are granted and determines the earliest expiration time.
 */
export async function checkAutoSignExpiration(
  granter: string,
  grantee: string,
  permissions: string[],
  restUrl: string,
): Promise<number | null> {
  try {
    if (!grantee) return null
    if (!permissions?.length) return null

    const client = ky.create({ prefixUrl: restUrl })

    // Check feegrant allowance
    const feegrantResponse = await client
      .get(`cosmos/feegrant/v1beta1/allowance/${granter}/${grantee}`)
      .json<{ allowance: { allowance?: { expiration?: string } } }>()

    // Check authz grants
    const grantsResponse = await client.get(`cosmos/authz/v1beta1/grants/grantee/${grantee}`).json<{
      grants: Array<{ granter: string; authorization: { msg: string }; expiration?: string }>
    }>()

    // Check that all required permissions have grants from the correct granter
    const relevantGrants = grantsResponse.grants.filter(
      (grant) => grant.granter === granter && permissions.includes(grant.authorization.msg),
    )

    const hasAllGrants = permissions.every((permission) =>
      relevantGrants.some((grant) => grant.authorization.msg === permission),
    )

    if (!hasAllGrants) {
      return null
    }

    const expirations = [
      ...relevantGrants.map((grant) => grant.expiration).filter(Boolean),
      feegrantResponse.allowance?.allowance?.expiration,
    ]
      .filter((expiration): expiration is string => !!expiration)
      .map((expirationString) => new Date(expirationString).getTime())

    const earliestExpiration = expirations.length > 0 ? Math.min(...expirations) : null

    return earliestExpiration
  } catch {
    return null
  }
}

/**
 * Hook that provides a validation function for auto-sign eligibility.
 * Performs comprehensive validation including message type authorization and active grant status.
 * Ensures transactions meet all requirements before bypassing manual signing.
 */
export function useValidateAutoSign() {
  const autoSignPermissions = useAutoSignPermissions()
  const autoSignState = useAutoSignState()

  return async (chainId: string, messages: EncodeObject[]): Promise<boolean> => {
    // Check if auto sign can handle this transaction type
    if (!canAutoSignHandleRequest({ messages, chainId }, autoSignPermissions)) {
      return false
    }

    // Check if auto sign is enabled for this chain
    const isAutoSignEnabled = await autoSignState.checkAutoSign()
    return isAutoSignEnabled[chainId] ?? false
  }
}

/**
 * Validates whether a transaction request can be automatically signed without user interaction.
 * Verifies that all message types in the request are authorized for auto-signing on the target chain.
 * Used to determine if a transaction should bypass the manual signing flow.
 */
export function canAutoSignHandleRequest(
  txRequest: TxRequest,
  autoSignPermissions?: Record<string, string[]>,
): boolean {
  if (!autoSignPermissions || !txRequest.chainId) {
    return false
  }

  const allowedMessageTypes = autoSignPermissions[txRequest.chainId]
  if (!allowedMessageTypes || allowedMessageTypes.length === 0) {
    return false
  }

  return txRequest.messages.every((message) => allowedMessageTypes.includes(message.typeUrl))
}

/**
 * Parses expiration times and determines validity status for each chain.
 * Converts Unix timestamp expirations to boolean enabled/disabled status based on current time.
 */
export function parseExpirationTimes(expirations: Record<string, number | null>) {
  return Object.fromEntries(
    Object.entries(expirations).map(([chainId, expirationTime]) => {
      return [chainId, !!expirationTime && expirationTime > Date.now()]
    }),
  )
}

/**
 * Finds the earliest valid expiration time from multiple chain expirations.
 * Filters out expired or undefined values and returns the minimum future timestamp.
 * Used to determine when the next permission will expire for timer setup.
 */
export function getEarliestExpiration(expirations: Record<string, number | null>) {
  const validExpirations = Object.values(expirations).filter(
    (expiration) => !!expiration && expiration > Date.now(),
  ) as number[]

  if (validExpirations.length === 0) return undefined
  return Math.min(...validExpirations)
}
