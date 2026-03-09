import type { MsgsResponseJson, TxJson } from "@skip-go/client"
import { type ReactNode, useEffect, useMemo, useState } from "react"
import Button from "@/components/Button"
import Footer from "@/components/Footer"
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
  const { route, values } = useBridgePreviewState()

  const [value, setValue] = useState<TxJson | undefined>(undefined)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  // Stabilize reference-type deps to avoid unnecessary refetches
  // when the containing arrays/objects are recreated with identical content
  const addressListKey = JSON.stringify(addressList)
  const operationsKey = JSON.stringify(route.operations)
  const signedOpHookKey = JSON.stringify(signedOpHook ?? null)

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const stableAddressList = useMemo(() => addressList, [addressListKey])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const stableOperations = useMemo(() => route.operations, [operationsKey])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const stableSignedOpHook = useMemo(() => signedOpHook, [signedOpHookKey])

  useEffect(() => {
    let cancelled = false

    const fetchMessages = async () => {
      try {
        setLoading(true)
        setError(null)

        if (route.required_op_hook && !stableSignedOpHook) {
          throw new Error("Op hook is required")
        }

        const params = {
          address_list: stableAddressList,
          amount_in: route.amount_in,
          amount_out: route.amount_out,
          source_asset_chain_id: route.source_asset_chain_id,
          source_asset_denom: route.source_asset_denom,
          dest_asset_chain_id: route.dest_asset_chain_id,
          dest_asset_denom: route.dest_asset_denom,
          slippage_tolerance_percent: values.slippagePercent,
          operations: stableOperations,
          signed_op_hook: stableSignedOpHook,
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
    stableAddressList,
    stableOperations,
    stableSignedOpHook,
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
