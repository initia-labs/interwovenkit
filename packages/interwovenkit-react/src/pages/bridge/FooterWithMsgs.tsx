import type { MsgsResponseJson, TxJson } from "@skip-go/client"
import { useEffect, useMemo, useState } from "react"
import Button from "@/components/Button"
import Footer from "@/components/Footer"
import type { RouterRouteResponseJson } from "./data/simulate"
import { useSkip } from "./data/skip"
import type { SignedOpHook } from "./data/tx"
import { useBridgePreviewState } from "./data/tx"
import FooterWithError from "./FooterWithError"

import type { ReactNode } from "react"

interface Props {
  addressList: string[]
  signedOpHook?: SignedOpHook
  children: (data: TxJson) => ReactNode
}

const FooterWithMsgs = ({ addressList, signedOpHook, children }: Props) => {
  const skip = useSkip()
  const { route, values } = useBridgePreviewState()

  const [value, setValue] = useState<TxJson | undefined>(undefined)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  const addressListKey = useMemo(() => JSON.stringify(addressList), [addressList])
  const operationsKey = useMemo(() => JSON.stringify(route.operations), [route.operations])
  const signedOpHookKey = useMemo(() => JSON.stringify(signedOpHook ?? null), [signedOpHook])

  const params = useMemo(
    () => ({
      address_list: JSON.parse(addressListKey) as string[],
      amount_in: route.amount_in,
      amount_out: route.amount_out,
      source_asset_chain_id: route.source_asset_chain_id,
      source_asset_denom: route.source_asset_denom,
      dest_asset_chain_id: route.dest_asset_chain_id,
      dest_asset_denom: route.dest_asset_denom,
      slippage_tolerance_percent: values.slippagePercent,
      operations: JSON.parse(operationsKey) as RouterRouteResponseJson["operations"],
      signed_op_hook: (JSON.parse(signedOpHookKey) as SignedOpHook | null) ?? undefined,
    }),
    [
      addressListKey,
      operationsKey,
      route.amount_in,
      route.amount_out,
      route.source_asset_chain_id,
      route.source_asset_denom,
      route.dest_asset_chain_id,
      route.dest_asset_denom,
      values.slippagePercent,
      signedOpHookKey,
    ],
  )

  useEffect(() => {
    const fetchMessages = async () => {
      try {
        if (route.required_op_hook && !params.signed_op_hook) {
          throw new Error("Op hook is required")
        }

        setLoading(true)
        setError(null)

        const { txs } = await skip
          .post("v2/fungible/msgs", { json: params })
          .json<MsgsResponseJson>()
        if (!txs || txs.length === 0) throw new Error("No transaction data found")
        const [tx] = txs
        setValue(tx)
      } catch (error) {
        setError(error as Error)
      } finally {
        setLoading(false)
      }
    }

    fetchMessages()
  }, [params, route.required_op_hook, skip])

  if (error) {
    return <FooterWithError error={error} />
  }

  if (loading || !value) {
    return (
      <Footer>
        <Button.White loading={"Fetching messages..."} />
      </Footer>
    )
  }

  return children(value)
}

export default FooterWithMsgs
