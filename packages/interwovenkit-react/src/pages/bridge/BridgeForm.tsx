import { useEffect } from "react"
import { FormProvider, useForm } from "react-hook-form"
import AsyncBoundary from "@/components/AsyncBoundary"
import Button from "@/components/Button"
import Indicator from "@/components/Indicator"
import Page from "@/components/Page"
import { LocalStorageKey } from "@/data/constants"
import { useHistory, useNavigate } from "@/lib/router"
import { useNotification } from "@/public/app/NotificationContext"
import { useAddress } from "@/public/data/hooks"
import { useGetDefaultAddress, useValidateAddress } from "./data/address"
import { findVisibleRouterAsset, getFirstVisibleRouterAsset, useSkipAssets } from "./data/assets"
import { useSkipChain } from "./data/chains"
import type { FormValues } from "./data/form"
import { createPersistedRecipient, useDefaultValues } from "./data/form"
import { useClaimableModal, useClaimableReminders } from "./op/reminder"
import BridgeFields from "./BridgeFields"

const BridgeForm = () => {
  useClaimableModal()

  const history = useHistory()
  const navigate = useNavigate()
  const address = useAddress()

  const defaultValues = useDefaultValues(address)
  const form = useForm<FormValues>({
    mode: "onChange",
    defaultValues,
  })

  const { watch, setValue } = form
  const { srcChainId, dstChainId, srcDenom, dstDenom, quantity, slippagePercent, recipient } =
    // React Hook Form's watch() is safe, React Compiler warning can be ignored
    // eslint-disable-next-line react-hooks/incompatible-library
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
  const { showNotification } = useNotification()
  const srcChain = useSkipChain(srcChainId)
  const dstChain = useSkipChain(dstChainId)
  const srcAssets = useSkipAssets(srcChainId)
  const dstAssets = useSkipAssets(dstChainId)
  const fallbackSrcAsset = getFirstVisibleRouterAsset(srcAssets)
  const fallbackDstAsset = getFirstVisibleRouterAsset(dstAssets)

  // Fall back to the first visible asset when the selected denom is not supported
  const isSrcDenomValid = !!findVisibleRouterAsset(srcAssets, srcDenom)
  const isDstDenomValid = !!findVisibleRouterAsset(dstAssets, dstDenom)
  useEffect(() => {
    if (fallbackSrcAsset && !isSrcDenomValid) {
      setValue("srcDenom", fallbackSrcAsset.denom)
      showNotification({
        type: "info",
        title: `Switched to ${fallbackSrcAsset.symbol}`,
        description: `The selected asset is not available on ${srcChain.pretty_name}.`,
        autoHide: true,
      })
    }
  }, [fallbackSrcAsset, isSrcDenomValid, setValue, showNotification, srcChain.pretty_name])
  useEffect(() => {
    if (fallbackDstAsset && !isDstDenomValid) {
      setValue("dstDenom", fallbackDstAsset.denom)
      showNotification({
        type: "info",
        title: `Switched to ${fallbackDstAsset.symbol}`,
        description: `The selected asset is not available on ${dstChain.pretty_name}.`,
        autoHide: true,
      })
    }
  }, [fallbackDstAsset, isDstDenomValid, setValue, showNotification, dstChain.pretty_name])

  // localStorage
  useEffect(() => {
    if (!isSrcDenomValid || !isDstDenomValid) return
    localStorage.setItem(LocalStorageKey.BRIDGE_SRC_CHAIN_ID, srcChainId)
    localStorage.setItem(LocalStorageKey.BRIDGE_SRC_DENOM, srcDenom)
    localStorage.setItem(LocalStorageKey.BRIDGE_DST_CHAIN_ID, dstChainId)
    localStorage.setItem(LocalStorageKey.BRIDGE_DST_DENOM, dstDenom)
    localStorage.setItem(LocalStorageKey.BRIDGE_QUANTITY, quantity)
    localStorage.setItem(LocalStorageKey.BRIDGE_SLIPPAGE_PERCENT, slippagePercent)
    if (address) {
      localStorage.setItem(
        LocalStorageKey.BRIDGE_RECIPIENT,
        createPersistedRecipient(address, recipient),
      )
    }
  }, [
    address,
    srcChainId,
    srcDenom,
    dstChainId,
    dstDenom,
    quantity,
    slippagePercent,
    recipient,
    isSrcDenomValid,
    isDstDenomValid,
  ])

  // render
  const isBridge = history[0].path === "/bridge"

  const { reminders } = useClaimableReminders()

  return (
    <Page
      title="Bridge/Swap"
      backButton={isBridge ? "/" : undefined}
      extra={
        <>
          <Button.Small
            onClick={() => navigate("/bridge/history")}
            unpadded
            aria-label="Bridge/Swap history"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 16 16"
              width="12"
              height="12"
              aria-hidden="true"
            >
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
      {isSrcDenomValid && isDstDenomValid && (
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
