import type { EncodeObject } from "@cosmjs/proto-signing"
import type { MsgGrant } from "@initia/initia.proto/cosmos/authz/v1beta1/tx"
import {
  AllowedMsgAllowance,
  BasicAllowance,
} from "@initia/initia.proto/cosmos/feegrant/v1beta1/feegrant"
import type { MsgGrantAllowance } from "@initia/initia.proto/cosmos/feegrant/v1beta1/tx"
import { formatAmount } from "@initia/utils"
import { useAssets } from "@/data/assets"
import { useChain } from "@/data/chains"
import type { FeegrantAllowance } from "@/pages/autosign/data/fetch"
import {
  type FeeAllowanceStatus,
  getAutoSignFeeAllowanceStatus,
} from "@/pages/autosign/data/inventory"
import {
  describeObservedAuthorization,
  parseObservedAuthorizationAny,
} from "@/pages/autosign/data/policy"
import styles from "./TxMessage.module.css"

const MSG_GRANT = "/cosmos.authz.v1beta1.MsgGrant"
const MSG_GRANT_ALLOWANCE = "/cosmos.feegrant.v1beta1.MsgGrantAllowance"
const ALLOWED_MSG_ALLOWANCE = "/cosmos.feegrant.v1beta1.AllowedMsgAllowance"
const BASIC_ALLOWANCE = "/cosmos.feegrant.v1beta1.BasicAllowance"
const DELEGATED_TX_MESSAGE = "/cosmos.authz.v1beta1.MsgExec"

type Summary =
  | {
      kind: "permission"
      grantee: string
      scope: string[]
      expiration?: Date
    }
  | {
      kind: "fees"
      grantee: string
      scope: string[]
      allowance: FeeAllowanceStatus
    }

function decodePermissionSummary(message: EncodeObject): Summary | undefined {
  if (message.typeUrl !== MSG_GRANT) return undefined
  const value = message.value as MsgGrant
  const authorization = value.grant?.authorization
  if (!authorization) return undefined
  const observed = parseObservedAuthorizationAny(authorization)
  if (observed.kind === "unknown") return undefined
  return {
    kind: "permission",
    grantee: value.grantee,
    scope: describeObservedAuthorization(observed),
    expiration: value.grant?.expiration,
  }
}

function decodeFeeSummary(message: EncodeObject): Summary | undefined {
  if (message.typeUrl !== MSG_GRANT_ALLOWANCE) return undefined
  const value = message.value as MsgGrantAllowance
  const allowance = value.allowance
  if (!allowance || allowance.typeUrl !== ALLOWED_MSG_ALLOWANCE) return undefined

  try {
    const allowed = AllowedMsgAllowance.decode(allowance.value)
    if (!allowed.allowedMessages.includes(DELEGATED_TX_MESSAGE) || !allowed.allowance)
      return undefined

    const inner = allowed.allowance
    const normalized: FeegrantAllowance = {
      granter: value.granter,
      grantee: value.grantee,
      allowance: {
        "@type": ALLOWED_MSG_ALLOWANCE,
        allowedMessages: allowed.allowedMessages,
        allowance: { "@type": inner.typeUrl },
      },
    }
    if (inner.typeUrl === BASIC_ALLOWANCE) {
      const basic = BasicAllowance.decode(inner.value)
      normalized.allowance.allowance = {
        "@type": BASIC_ALLOWANCE,
        spendLimit: basic.spendLimit,
        expiration: basic.expiration?.toISOString(),
      }
    }

    return {
      kind: "fees",
      grantee: value.grantee,
      scope: allowed.allowedMessages.map((messageType) =>
        messageType === DELEGATED_TX_MESSAGE ? "Delegated transactions only" : messageType,
      ),
      allowance: getAutoSignFeeAllowanceStatus(normalized),
    }
  } catch {
    return undefined
  }
}

const AutoSignGrantSummary = ({ message, chainId }: { message: EncodeObject; chainId: string }) => {
  const chain = useChain(chainId)
  const assets = useAssets(chain)
  const summary = decodePermissionSummary(message) ?? decodeFeeSummary(message)
  if (!summary) return null

  const formatCoins = (coins: Array<{ amount: string; denom: string }>) =>
    coins
      .map(({ amount, denom }) => {
        const asset = assets.find((candidate) => candidate.denom === denom)
        return asset && Number.isInteger(asset.decimals) && asset.decimals >= 0
          ? `${formatAmount(amount, { decimals: asset.decimals })} ${asset.symbol || denom}`
          : `${amount} ${denom}`
      })
      .join(", ")

  const feeBudget =
    summary.kind === "fees"
      ? summary.allowance.kind === "unlimited"
        ? "Unlimited"
        : summary.allowance.kind === "limited"
          ? formatCoins(summary.allowance.spendLimit)
          : "Unable to decode"
      : undefined
  const expiration =
    summary.kind === "permission"
      ? summary.expiration
      : summary.allowance.kind === "unknown"
        ? "Unknown"
        : "expiration" in summary.allowance
          ? summary.allowance.expiration
          : undefined

  return (
    <section className={styles.summary} aria-label="Auto-signing approval summary">
      <div className={styles.summaryTitle}>
        {summary.kind === "permission" ? "Permission summary" : "Fee allowance summary"}
      </div>
      <div>
        <div className={styles.key}>Granted to</div>
        <div className={styles.value}>{summary.grantee}</div>
      </div>
      <div>
        <div className={styles.key}>Scope</div>
        {summary.scope.map((line) => (
          <div className={styles.value} key={line}>
            {line}
          </div>
        ))}
      </div>
      {feeBudget && (
        <div>
          <div className={styles.key}>Total fee budget</div>
          <div className={styles.value}>{feeBudget}</div>
        </div>
      )}
      <div>
        <div className={styles.key}>Expires</div>
        <div className={styles.value}>
          {expiration instanceof Date ? expiration.toLocaleString() : (expiration ?? "Never")}
        </div>
      </div>
    </section>
  )
}

export default AutoSignGrantSummary
