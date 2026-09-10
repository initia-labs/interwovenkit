import { isPast } from "date-fns"
import { formatAmount } from "@initia/utils"
import FormHelp from "@/components/form/FormHelp"
import Image from "@/components/Image"
import { useAssets } from "@/data/assets"
import { useChain } from "@/data/chains"
import { useNavigate } from "@/lib/router"
import { useDisableAutoSign } from "@/pages/autosign/data/actions"
import {
  type FeeAllowanceStatus,
  type GrantAttribution,
  type GrantAuthorizationInventory,
} from "@/pages/autosign/data/inventory"
import { useAutoSignStatus } from "@/pages/autosign/data/validation"
import ExpirationCountdown from "./ExpirationCountdown"
import styles from "./GrantItem.module.css"

interface GrantItemProps {
  chainId: string
  grantee: string
  expiration?: Date
  authorizations: GrantAuthorizationInventory[]
  attribution: GrantAttribution
  feeAllowance: FeeAllowanceStatus
  canRevoke: boolean
  revokeReason?: string
}

const GrantItem = ({
  chainId,
  grantee,
  expiration,
  authorizations,
  attribution,
  feeAllowance,
  canRevoke,
  revokeReason,
}: GrantItemProps) => {
  const chain = useChain(chainId)
  const navigate = useNavigate()
  const assets = useAssets(chain)
  const { data: autoSignStatus } = useAutoSignStatus()

  const {
    mutate,
    isPending,
    error: revokeError,
  } = useDisableAutoSign({
    grantee,
    internal: true,
  })

  const hasUnknownAuthorization = authorizations.some((authorization) => !authorization.known)
  const feeLabel =
    feeAllowance.kind === "unknown"
      ? "Unable to inspect"
      : feeAllowance.kind === "unlimited"
        ? "Unlimited"
        : feeAllowance.kind === "limited"
          ? feeAllowance.remainingObserved
              .map(({ amount, denom }) => {
                const asset = assets.find((candidate) => candidate.denom === denom)
                return asset && Number.isInteger(asset.decimals) && asset.decimals >= 0
                  ? `${formatAmount(amount, { decimals: asset.decimals })} ${asset.symbol || denom}`
                  : `${amount} ${denom}`
              })
              .join(", ") + " remaining"
          : "No allowance"

  return (
    <div className={styles.container}>
      <div className={styles.top}>
        <div className={styles.info}>
          <div className={styles.header}>
            <Image src={chain.logoUrl} width={16} height={16} logo />
            <div className={styles.chainName}>{chain.name}</div>
            {attribution !== "local-current" && (
              <span className={styles.attribution}>
                {attribution === "locally-known" ? "Previous" : "Unrecognized"}
              </span>
            )}
          </div>
          <div className={styles.expiration}>
            {!expiration ? "Until revoked" : <ExpirationCountdown expiration={expiration} />}
          </div>
        </div>
        <div className={styles.actions}>
          {attribution === "local-current" && expiration && isPast(expiration) && (
            <button
              className={styles.reconnectButton}
              onClick={() =>
                navigate("/autosign/reconnect", {
                  chainId,
                  durationInMs: autoSignStatus?.requestedDurationInMsByChain[chainId],
                })
              }
            >
              Reconnect
            </button>
          )}
          <button
            className={styles.revokeButton}
            onClick={() => mutate(chainId)}
            disabled={isPending || !canRevoke}
            aria-busy={isPending}
            title={!canRevoke ? (revokeReason ?? "No revocable approval found") : undefined}
          >
            {isPending ? "Revoking..." : hasUnknownAuthorization ? "Revoke known" : "Revoke"}
          </button>
        </div>
      </div>
      <div className={styles.stat}>
        <span>Fees</span>
        <span>{feeLabel}</span>
      </div>
      <details className={styles.details}>
        <summary>Permission details</summary>
        <div className={styles.detailsContent}>
          <div>
            <span>
              {attribution === "local-current"
                ? "Current auto-signing address"
                : attribution === "locally-known"
                  ? "Previously used auto-signing address"
                  : "Unrecognized auto-signing address"}
            </span>
            <p className="monospace">{grantee}</p>
          </div>
          <div>
            <span>Scope</span>
            {authorizations.flatMap(({ description, typeUrl }, authorizationIndex) =>
              description.map((line, descriptionIndex) => (
                <p key={`${typeUrl}:${authorizationIndex}:${descriptionIndex}`}>{line}</p>
              )),
            )}
          </div>
          {hasUnknownAuthorization && (
            <p className={styles.warning}>
              Revoke known removes only permissions that can be identified safely. Unknown
              permissions may remain active.
            </p>
          )}
          <p>
            {attribution === "local-current"
              ? "Locally matched to this app. Chain permissions do not identify an app or browser."
              : "The chain cannot identify which app or browser created this permission."}
          </p>
        </div>
      </details>
      {revokeError && <FormHelp level="error">{revokeError.message}</FormHelp>}
    </div>
  )
}

export default GrantItem
