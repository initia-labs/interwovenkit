import { useEffect, useMemo, useState } from "react"
import { useSetAtom } from "jotai"
import { useQueryClient } from "@tanstack/react-query"
import { useDefaultChain } from "@/data/chains"
import { formatDuration } from "@/pages/bridge/data/format"
import { YEAR_IN_MS } from "@/pages/ghost-wallet/constants"
import { ghostWalletExpirationAtom, useEmbeddedWalletAddress } from "@/pages/ghost-wallet/hooks"
import { ghostWalletQueryKeys, useAllGrants } from "@/pages/ghost-wallet/queries"
import { useInterwovenKit } from "@/public/data/hooks"
import styles from "./RevokeGrantsItem.module.css"

interface RevokeGrantsItemProps {
  grantee: string
  expiration: string
}

const RevokeGrantsItem = ({ grantee, expiration }: RevokeGrantsItemProps) => {
  const defaultChain = useDefaultChain()
  const { initiaAddress, requestTxBlock } = useInterwovenKit()
  const { data: grants } = useAllGrants()
  const queryClient = useQueryClient()
  const setGhostWalletExpiration = useSetAtom(ghostWalletExpirationAtom)
  const embeddedWalletAddress = useEmbeddedWalletAddress()

  // Track current time to trigger re-renders every second
  const [currentTime, setCurrentTime] = useState(() => Date.now())

  // Calculate if it's a long-term expiration (doesn't change)
  const isLongTerm = useMemo(() => {
    const expirationTime = new Date(expiration).getTime()
    // eslint-disable-next-line react-hooks/purity
    const initialRemainingTime = expirationTime - Date.now()
    return initialRemainingTime > YEAR_IN_MS
  }, [expiration])

  // Calculate the formatted duration based on current time
  const formattedDuration = useMemo(() => {
    if (isLongTerm) return null

    const expirationTime = new Date(expiration).getTime()
    const remainingTime = Math.max(0, expirationTime - currentTime)
    return formatDuration(Math.floor(remainingTime / 1000))
  }, [expiration, currentTime, isLongTerm])

  // Check if the grant has expired
  const hasExpired = useMemo(() => {
    if (isLongTerm) return false
    const expirationTime = new Date(expiration).getTime()
    return currentTime >= expirationTime
  }, [expiration, currentTime, isLongTerm])

  // Update the current time every second to trigger countdown updates
  useEffect(() => {
    if (isLongTerm) return // No need to update for long-term expirations

    const timer = setInterval(() => {
      setCurrentTime(Date.now())
    }, 1000)

    return () => clearInterval(timer)
  }, [isLongTerm])

  const handleRevoke = async () => {
    if (!grants || !initiaAddress) return

    // Find all grants for this grantee
    const granteeGrants = grants.grants.filter((grant) => grant.grantee === grantee)

    // Create MsgRevoke messages for each grant
    const authzMessages = granteeGrants.map((grant) => ({
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
      messages,
      internal: "/revoke-grants",
    })

    // Invalidate the grants query to refresh the data
    queryClient.invalidateQueries({
      queryKey: ghostWalletQueryKeys.grantsByGranter._def,
    })

    // Reset ghost wallet expiration if this is the embedded wallet address
    if (grantee === embeddedWalletAddress) {
      setGhostWalletExpiration((exp) => ({ ...exp, [defaultChain.chainId]: undefined }))
    }
  }

  // Don't render the item if it has expired
  if (hasExpired) {
    return null
  }

  return (
    <div className={styles.container}>
      <div className={styles.textContainer}>
        <div className={styles.chain}>{defaultChain.chainId}</div>
        <div className={styles.expiration}>
          {isLongTerm ? (
            "Until revoked"
          ) : (
            <>
              Expires in <span className={styles.expirationTime}>{formattedDuration}</span>
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
