import type { MsgsResponseJson, TxJson } from "@skip-go/client"
import { type ReactNode, useEffect, useState } from "react"
import Button from "@/components/Button"
import Footer from "@/components/Footer"
import { getBridgeMsgsRequestKey } from "./data/messageRequestKey"
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

  const requestKey = getBridgeMsgsRequestKey({
    addressList,
    operations: route.operations,
    signedOpHook,
    quoteVerifiedAt,
  })

  useEffect(() => {
    let cancelled = false

    const fetchMessages = async () => {
      try {
        setLoading(true)
        setError(null)

        if (route.required_op_hook && !signedOpHook) {
          throw new Error("Op hook is required")
        }

        const params = {
          address_list: addressList,
          amount_in: route.amount_in,
          amount_out: route.amount_out,
          source_asset_chain_id: route.source_asset_chain_id,
          source_asset_denom: route.source_asset_denom,
          dest_asset_chain_id: route.dest_asset_chain_id,
          dest_asset_denom: route.dest_asset_denom,
          slippage_tolerance_percent: values.slippagePercent,
          operations: route.operations,
          signed_op_hook: signedOpHook,
        }

        const { txs } = await skip
          .post("v2/fungible/msgs", { json: params })
          .json<MsgsResponseJson>()
        if (cancelled) return
        if (!txs || txs.length === 0) throw new Error("No transaction data found")
        const [tx] = txs
        setValue(tx)
      } catch (error) {
        if (cancelled) return
        setError(error as Error)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    fetchMessages()
    return () => {
      cancelled = true
    }
  }, [
    requestKey,
    addressList,
    route.amount_in,
    route.amount_out,
    route.source_asset_chain_id,
    route.source_asset_denom,
    route.dest_asset_chain_id,
    route.dest_asset_denom,
    route.operations,
    route.required_op_hook,
    signedOpHook,
    values.slippagePercent,
    skip,
  ])

  const status = getFooterWithMsgsStatus({ error, loading, value })

  if (status.shouldRenderError) {
    return <FooterWithError error={error as Error} />
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
