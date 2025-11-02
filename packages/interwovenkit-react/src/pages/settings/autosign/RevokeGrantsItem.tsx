import { useEffect, useMemo, useState } from "react"
import { useSetAtom } from "jotai"
import { useQueryClient } from "@tanstack/react-query"
import { YEAR_IN_MS } from "@/data/constants"
import { autoSignQueryKeys, useAllGrants } from "@/pages/autosign/data/queries"
import { autoSignExpirationAtom } from "@/pages/autosign/data/state"
import { useEmbeddedWalletAddress } from "@/pages/autosign/data/wallet"
import { formatDuration } from "@/pages/bridge/data/format"
import { useInterwovenKit } from "@/public/data/hooks"
import styles from "./RevokeGrantsItem.module.css"

interface RevokeGrantsItemProps {
  grantee: string
  expiration: string
  chainId: string
}

const RevokeGrantsItem = ({ grantee, expiration, chainId }: RevokeGrantsItemProps) => {
  const { initiaAddress, requestTxBlock } = useInterwovenKit()
  const allGrantsQueries = useAllGrants()
  const queryClient = useQueryClient()
  const setAutoSignExpiration = useSetAtom(autoSignExpirationAtom)
  const embeddedWalletAddress = useEmbeddedWalletAddress()

  // Get grants for the current chain and grantee
  const currentGrants = useMemo(() => {
    const query = allGrantsQueries.find((q) => q.isSuccess && q.data?.chainId === chainId)
    if (!query?.data) return []
    return query.data.grants.filter((grant) => grant.grantee === grantee)
  }, [allGrantsQueries, chainId, grantee])

  // Track current timestamp to trigger re-renders every second
  const [currentTimestamp, setCurrentTimestamp] = useState(() => Date.now())

  // Calculate if it's a long-term expiration (doesn't change)
  const hasLongTermExpiration = useMemo(() => {
    const expirationTimestamp = new Date(expiration).getTime()
    // we don't care about updates to this value, so it's safe to read current time only once
    const initialRemainingMilliseconds = expirationTimestamp - Date.now() // eslint-disable-line react-hooks/purity
    return initialRemainingMilliseconds > YEAR_IN_MS
  }, [expiration])

  // Calculate the formatted duration based on current timestamp
  const expirationCountdownText = useMemo(() => {
    if (hasLongTermExpiration) return null

    const expirationTimestamp = new Date(expiration).getTime()
    const remainingMilliseconds = Math.max(0, expirationTimestamp - currentTimestamp)
    return formatDuration(Math.floor(remainingMilliseconds / 1000))
  }, [expiration, currentTimestamp, hasLongTermExpiration])

  // Check if the grant has expired
  const isGrantExpired = useMemo(() => {
    if (hasLongTermExpiration) return false
    const expirationTimestamp = new Date(expiration).getTime()
    return currentTimestamp >= expirationTimestamp
  }, [expiration, currentTimestamp, hasLongTermExpiration])

  // Update the current timestamp every second to trigger countdown updates
  useEffect(() => {
    if (hasLongTermExpiration) return // No need to update for long-term expirations

    const timer = setInterval(() => {
      setCurrentTimestamp(Date.now())
    }, 1000)

    return () => clearInterval(timer)
  }, [hasLongTermExpiration])

  const handleRevoke = async () => {
    if (currentGrants.length === 0 || !initiaAddress) return

    // Create MsgRevoke messages for each grant
    const authzMessages = currentGrants.map((grant) => ({
      typeUrl: "/cosmos.authz.v1beta1.MsgRevoke",
      value: {
        granter: initiaAddress,
        grantee: grant.grantee,
        msgTypeUrl: grant.authorization.msg,
      },
    }))

    // Add MsgRevokeAllowance to revoke feegrant
    const revokeAllowanceMessage = {
      typeUrl: "/cosmos.feegrant.v1beta1.MsgRevokeAllowance",
      value: {
        granter: initiaAddress,
        grantee: grantee,
      },
    }

    const messages = [...authzMessages, revokeAllowanceMessage]

    await requestTxBlock({
      chainId,
      messages,
      internal: "/settings/autosign",
    })

    // Invalidate the grants query to refresh the data
    queryClient.invalidateQueries({
      queryKey: autoSignQueryKeys.grantsByGranter._def,
    })

    // Reset auto sign expiration if this is the embedded wallet address
    if (grantee === embeddedWalletAddress) {
      setAutoSignExpiration((expirationMap) => ({ ...expirationMap, [chainId]: null }))
    }
  }

  // Don't render the item if it has expired
  if (isGrantExpired) {
    // Invalidate the grants query to refresh the data
    queryClient.invalidateQueries({
      queryKey: autoSignQueryKeys.grantsByGranter._def,
    })

    return null
  }

  return (
    <div className={styles.container}>
      <div className={styles.textContainer}>
        <div className={styles.chain}>{chainId}</div>
        <div className={styles.expiration}>
          {hasLongTermExpiration ? (
            "Until revoked"
          ) : (
            <>
              Expires in <span className={styles.expirationTime}>{expirationCountdownText}</span>
            </>
          )}
        </div>
      </div>

      <button className={styles.revokeButton} onClick={handleRevoke}>
        Revoke
      </button>
    </div>
  )
}

export default RevokeGrantsItem
