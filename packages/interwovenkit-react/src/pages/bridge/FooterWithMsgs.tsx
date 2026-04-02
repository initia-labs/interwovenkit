import type { TxJson } from "@skip-go/client"
import { type ReactNode, useEffect, useRef, useState } from "react"
import Button from "@/components/Button"
import Footer from "@/components/Footer"
import { normalizeError } from "@/data/http"
import { fetchBridgeTxs } from "./data/bridgeTxUtils"
import {
  getBridgeMsgsRequestKey,
  shouldRetryBridgeMsgsAfterQuoteRefresh,
} from "./data/messageRequestKey"
import { useSkip } from "./data/skip"
import type { SignedOpHook } from "./data/tx"
import { useBridgePreviewState } from "./data/tx"
import FooterWithError from "./FooterWithError"

interface Props {
  addressList: string[]
  signedOpHook?: SignedOpHook
  children: (
    data: TxJson,
    status: { isFetchingMessages: boolean; messageRefreshError?: string },
  ) => ReactNode
}

function getFooterWithMsgsStatus<T>({
  error,
  loading,
  value,
}: {
  error: Error | null
  loading: boolean
  value: T | undefined
}) {
  const hasValue = value !== undefined

  return {
    isFetchingMessages: loading,
    messageRefreshError: !loading && hasValue && error ? error.message : undefined,
    shouldRenderError: !!error && !hasValue,
    shouldRenderLoading: !hasValue,
  }
}

const FooterWithMsgs = ({ addressList, signedOpHook, children }: Props) => {
  const skip = useSkip()
  const { route, values, quoteVerifiedAt } = useBridgePreviewState()

  const [value, setValue] = useState<TxJson | undefined>(undefined)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const [recoveryAttemptVersion, setRecoveryAttemptVersion] = useState(0)
  const previousQuoteVerifiedAtRef = useRef<number | undefined>(quoteVerifiedAt)

  const requestKey = getBridgeMsgsRequestKey({
    addressList,
    operations: route.operations,
    signedOpHook,
  })

  useEffect(() => {
    const previousQuoteVerifiedAt = previousQuoteVerifiedAtRef.current

    if (
      shouldRetryBridgeMsgsAfterQuoteRefresh({
        previousQuoteVerifiedAt,
        quoteVerifiedAt,
        hasValue: value !== undefined,
        hasMessageRefreshError: error !== null,
      })
    ) {
      setRecoveryAttemptVersion((version) => version + 1)
    }

    previousQuoteVerifiedAtRef.current = quoteVerifiedAt
  }, [quoteVerifiedAt, value, error])

  useEffect(() => {
    let cancelled = false

    const fetchMessages = async () => {
      try {
        setLoading(true)
        setError(null)

        if (route.required_op_hook && !signedOpHook) {
          throw new Error("Op hook is required")
        }

        const txs = await fetchBridgeTxs(skip, {
          addressList,
          route: {
            amount_in: route.amount_in,
            amount_out: route.amount_out,
            source_asset_chain_id: route.source_asset_chain_id,
            source_asset_denom: route.source_asset_denom,
            dest_asset_chain_id: route.dest_asset_chain_id,
            dest_asset_denom: route.dest_asset_denom,
            operations: route.operations,
          },
          slippagePercent: String(values.slippagePercent),
          signedOpHook,
        })
        if (cancelled) return
        const [tx] = txs
        setValue(tx)
      } catch (error) {
        if (cancelled) return
        setError(await normalizeError(error))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    fetchMessages()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- requestKey tracks reference-type inputs by content
  }, [
    requestKey,
    recoveryAttemptVersion,
    route.amount_in,
    route.amount_out,
    route.source_asset_chain_id,
    route.source_asset_denom,
    route.dest_asset_chain_id,
    route.dest_asset_denom,
    route.required_op_hook,
    values.slippagePercent,
    skip,
  ])

  const status = getFooterWithMsgsStatus({ error, loading, value })

  if (status.shouldRenderError && error) {
    return <FooterWithError error={error} />
  }

  if (status.shouldRenderLoading) {
    return (
      <Footer>
        <Button.White loading={"Fetching messages..."} />
      </Footer>
    )
  }

  return children(value as TxJson, {
    isFetchingMessages: status.isFetchingMessages,
    messageRefreshError: status.messageRefreshError,
  })
}

export default FooterWithMsgs
