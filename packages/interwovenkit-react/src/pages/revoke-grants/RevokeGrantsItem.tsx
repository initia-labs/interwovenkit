import { useSetAtom } from "jotai"
import { useQueryClient } from "@tanstack/react-query"
import { formatDuration } from "@/pages/bridge/data/format"
import { useDefaultChain } from "@/data/chains"
import { useInterwovenKit } from "@/public/data/hooks"
import { useAllGrants, ghostWalletQueryKeys } from "@/pages/ghost-wallet/queries"
import { ghostWalletExpirationAtom, useEmbeddedWalletAddress } from "@/pages/ghost-wallet/hooks"
import { YEAR_IN_MS } from "@/pages/ghost-wallet/constants"
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

  return (
    <div className={styles.container}>
      <div className={styles.textContainer}>
        <div className={styles.chain}>{defaultChain.chainId}</div>
        <div className={styles.expiration}>
          {new Date(expiration).getTime() - Date.now() > YEAR_IN_MS ? (
            "Until revoked"
          ) : (
            <>
              Expires in{" "}
              <span className={styles.expirationTime}>
                {formatDuration(Math.floor((new Date(expiration).getTime() - Date.now()) / 1000))}
              </span>
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
