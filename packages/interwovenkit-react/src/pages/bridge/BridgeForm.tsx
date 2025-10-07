import { useEffect, useMemo } from "react"
import { FormProvider, useForm } from "react-hook-form"
import AsyncBoundary from "@/components/AsyncBoundary"
import Button from "@/components/Button"
import Footer from "@/components/Footer"
import Indicator from "@/components/Indicator"
import Page from "@/components/Page"
import Status from "@/components/Status"
import { LocalStorageKey } from "@/data/constants"
import { useDrawer } from "@/data/ui"
import { useHistory, useNavigate } from "@/lib/router"
import { useAddress } from "@/public/data/hooks"
import { useGetDefaultAddress, useValidateAddress } from "./data/address"
import { useSkipAssets } from "./data/assets"
import type { FormValues } from "./data/form"
import { useDefaultValues } from "./data/form"
import { useClaimableModal, useClaimableReminders } from "./op/reminder"
import BridgeFields from "./BridgeFields"

const BridgeForm = () => {
  useClaimableModal()

  const history = useHistory()
  const navigate = useNavigate()
  const { closeDrawer } = useDrawer()
  const address = useAddress()

  const defaultValues = useDefaultValues()
  const form = useForm<FormValues>({
    mode: "onChange",
    defaultValues,
  })

  const { watch, setValue } = form
  const { srcChainId, dstChainId, srcDenom, dstDenom, quantity, slippagePercent, recipient } =
    watch()

  watch((_, { name }) => {
    if (name === "srcChainId" || name === "srcDenom") {
      // Use setValue instead of resetField to prevent localStorage values from appearing unexpectedly
      setValue("quantity", "", { shouldTouch: false, shouldDirty: false })
    }
  })

  // address
  const getDefaultAddress = useGetDefaultAddress()
  const defaultSenderAddress = getDefaultAddress(srcChainId)
  const defaultRecipientAddress = getDefaultAddress(dstChainId)
  const validateAddress = useValidateAddress()
  const isValidRecipient = validateAddress(recipient, dstChainId)
  useEffect(() => {
    setValue("cosmosWalletName", undefined)
    setValue("sender", defaultSenderAddress)
  }, [srcChainId, defaultSenderAddress, setValue])
  useEffect(() => {
    if (!isValidRecipient) setValue("recipient", defaultRecipientAddress)
  }, [defaultRecipientAddress, isValidRecipient, setValue])

  // assets
  const srcAssets = useSkipAssets(srcChainId)
  const dstAssets = useSkipAssets(dstChainId)

  const errorMessage = useMemo(() => {
    if (!srcAssets.find((srcAsset) => srcAsset.denom === srcDenom)) {
      return `${srcDenom} is not available for bridge/swap on ${srcChainId}`
    }
    if (!dstAssets.find((dstAsset) => dstAsset.denom === dstDenom)) {
      return `${dstDenom} is not available for bridge/swap on ${dstChainId}`
    }
  }, [dstAssets, dstChainId, dstDenom, srcAssets, srcChainId, srcDenom])

  // localStorage
  useEffect(() => {
    if (errorMessage) return
    localStorage.setItem(LocalStorageKey.BRIDGE_SRC_CHAIN_ID, srcChainId)
    localStorage.setItem(LocalStorageKey.BRIDGE_SRC_DENOM, srcDenom)
    localStorage.setItem(LocalStorageKey.BRIDGE_DST_CHAIN_ID, dstChainId)
    localStorage.setItem(LocalStorageKey.BRIDGE_DST_DENOM, dstDenom)
    localStorage.setItem(LocalStorageKey.BRIDGE_QUANTITY, quantity)
    localStorage.setItem(LocalStorageKey.BRIDGE_SLIPPAGE_PERCENT, slippagePercent)
  }, [srcChainId, srcDenom, dstChainId, dstDenom, quantity, slippagePercent, errorMessage])

  // render
  const isBridge = history[0].path === "/bridge"

  const renderError = () => {
    return (
      <>
        <Status error>{errorMessage}</Status>
        <Footer>
          {isBridge ? (
            <Button.White onClick={closeDrawer}>Close</Button.White>
          ) : (
            <Button.White onClick={() => navigate(-1)}>Go back</Button.White>
          )}
        </Footer>
      </>
    )
  }

  const { reminders } = useClaimableReminders()

  return (
    <Page
      title="Bridge/Swap"
      backButton={isBridge ? "/" : undefined}
      extra={
        <>
          <Button.Small onClick={() => navigate("/bridge/history")} unpadded>
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="12" height="12">
              <path d="m0 9.818 1.414-1.414 L2 8.99 V8 a7 7 0 1 1 7 7 v-2 a5 5 0 1 0-5-5 v1.354 l.95-.95 1.414 1.414 L3.182 13 0 9.818 Z" />
              <path d="M9 5.5 H7.5 v3.75 h3.75 v-1.5 H9 V5.5 Z" />
            </svg>
          </Button.Small>
          <Indicator offset={0} disabled={reminders.length === 0}>
            <Button.Small onClick={() => navigate("/op/withdrawals")} disabled={!address}>
              <span>Withdrawal status</span>
            </Button.Small>
          </Indicator>
        </>
      }
    >
      {errorMessage ? (
        renderError()
      ) : (
        <FormProvider {...form}>
          <AsyncBoundary>
            <BridgeFields />
          </AsyncBoundary>
        </FormProvider>
      )}
    </Page>
  )
}

export default BridgeForm
