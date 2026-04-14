import type { TxJson } from "@skip-go/client"
import { type ReactNode, useEffect, useRef } from "react"
import Button from "@/components/Button"
import Footer from "@/components/Footer"
import { shouldRetryBridgeMsgsAfterQuoteRefresh } from "./data/messageRequestKey"
import { useBridgeTxQuery } from "./data/preparation"
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
  const { route, values, quoteVerifiedAt } = useBridgePreviewState()
  const previousQuoteVerifiedAtRef = useRef<number | undefined>(quoteVerifiedAt)
  const {
    data: value,
    error,
    isLoading,
    isFetching,
    refetch,
  } = useBridgeTxQuery(route, values, addressList, signedOpHook)

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
      void refetch()
    }

    previousQuoteVerifiedAtRef.current = quoteVerifiedAt
  }, [error, quoteVerifiedAt, refetch, value])

  const status = getFooterWithMsgsStatus({ error, loading: isLoading || isFetching, value })

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
