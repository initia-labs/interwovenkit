import clsx from "clsx"
import QRCodeStyling from "qr-code-styling"
import { useEffect, useRef, useState } from "react"
import { IconCopy, IconWarningFilled } from "@initia/icons-react"
import Collapsible from "@/components/Collapsible"
import CopyButton from "@/components/CopyButton"
import DetailRow from "@/components/DetailRow"
import Image from "@/components/Image"
import { useSkipChains } from "@/pages/bridge/data/chains"
import { usePortalCssVariable } from "@/public/app/PortalContext"
import { useInitiaAddress } from "@/public/data/hooks"
import { useProcessingTime } from "../data/assets"
import { useFreshDepositAddress } from "../data/depositAddress"
import { DepositAddressMismatchError, useActiveDeposits, useNewDeposits } from "../data/deposits"
import { fallbackChainName, formatSlippagePercent, formatSourceMin } from "../data/source"
import { useSourceAssetOptions } from "../data/sourceAssets"
import { useDepositForm, useDepositNavigate } from "../context"
import DepositSubpage from "../DepositSubpage"
import ProcessingTimeValue from "../ProcessingTimeValue"
import SourceSelector, { type SourceOption } from "./SourceSelector"
import styles from "./DepositAddress.module.css"

/**
 * Crypto deposit-address screen (the "Deposit via address" method). The source
 * asset is display-only — the address is keyed by the destination and accepts
 * any supported source — while the chain selector stays interactive because
 * each source chain carries its own minimum. Auto-advances to tracking once a
 * deposit is detected. Source metadata resolves from the Router (Skip), whose
 * identifiers match the Deposit API's src_chain_id / src_denom.
 */
const DepositAddress = () => {
  const navigate = useDepositNavigate()
  const { watch } = useDepositForm()
  const walletAddress = useInitiaAddress()

  const receiveSymbol = watch("receiveSymbol")
  const receiveDenom = watch("receiveDenom")
  const receiveChainId = watch("receiveChainId")

  const options = useSourceAssetOptions(receiveChainId, receiveDenom)
  const selectedAsset = options[0]
  const routes = selectedAsset?.routes ?? []

  // Chain selection: per-chain minimums only — the deposit address is keyed by
  // the destination (see useDepositAddress), so changing the chain never
  // changes the address.
  const [selectedChainId, setSelectedChainId] = useState(routes[0]?.src_chain_id ?? "")
  const activeChainId = routes.some((route) => route.src_chain_id === selectedChainId)
    ? selectedChainId
    : (routes[0]?.src_chain_id ?? "")
  const selectedRoute = routes.find((route) => route.src_chain_id === activeChainId)

  const minLabel = selectedRoute
    ? formatSourceMin(
        selectedRoute.min_deposit_amount,
        selectedRoute.src_decimals,
        selectedAsset?.symbol ?? "",
      )
    : ""

  // Best-effort processing estimate for (selected source route -> receive
  // network): reads "estimating" while the backend warms its router-estimate
  // cache, "unavailable" past the retry cap (see useProcessingTime).
  const processingTime = useProcessingTime(selectedRoute, receiveChainId, receiveDenom)

  const skipChains = useSkipChains()
  const selectedChainLogoUrl =
    skipChains.find((chain) => chain.chain_id === activeChainId)?.logo_uri ?? ""
  const chainOptions: SourceOption[] = routes.map((route) => {
    const chain = skipChains.find((chain) => chain.chain_id === route.src_chain_id)
    return {
      value: route.src_chain_id,
      label: chain?.pretty_name ?? fallbackChainName(route.src_chain_id),
      logoUrl: chain?.logo_uri ?? "",
      minLabel: `Min ${formatSourceMin(route.min_deposit_amount, route.src_decimals, selectedAsset?.symbol ?? "")}`,
    }
  })

  // The fresh variant reissues the detection cursor for this mount; the address
  // renders instantly from cache. A failed reissue surfaces through the error
  // branch below with no Retry button — backing out and re-entering already
  // retries.
  const { query, freshCursor } = useFreshDepositAddress({
    walletAddress,
    chainId: receiveChainId,
    assetDenom: receiveDenom,
  })
  const { data, isPending, isError, error } = query
  const depositAddress = data?.deposit_address ?? ""

  // Detection poll on the cursor watermark ("created after this mount's
  // cursor") — auto-advance to tracking on any result; there is no "I've sent
  // it" button. The address is deterministic and reused, so the cursor is what
  // keeps old deposits from advancing, including one still bridging from an
  // earlier session (auto-advancing on it would hijack a user here to make a
  // new deposit). A deposit fast enough to finish between polls still advances.
  const detection = useNewDeposits({ depositAddress, after: freshCursor })
  const shouldAdvance = !!detection.data?.length
  useEffect(() => {
    if (shouldAdvance) navigate("track")
  }, [shouldAdvance, navigate])

  // Counterpart of the cursor gate above: a still-bridging transfer from an
  // earlier session stays reachable through an explicit resume link instead of
  // auto-navigation, so the resume intent and the new-deposit intent coexist.
  // Polled, so the link disappears once the transfer settles.
  const activeDeposits = useActiveDeposits(depositAddress)
  const hasTransferInProgress = !!activeDeposits.data?.length

  // Both polls hit the same list endpoint and either failing degrades this
  // screen the same way, so they share the retry banner. The typed mismatch
  // violation is the exception: every poll reproduces it, so a "recovers soon"
  // banner would never heal; it takes the hard-error branch like an
  // address-issuance failure (see DepositAddressMismatchError).
  const mismatchError = [detection.error, activeDeposits.error].find(
    (pollError) => pollError instanceof DepositAddressMismatchError,
  )
  const isPollError = (detection.isError || activeDeposits.isError) && !mismatchError
  const hardError = (isError ? error : null) ?? mismatchError ?? null

  const ref = useRef<HTMLDivElement>(null)
  const qrCode = useRef<QRCodeStyling | null>(null)
  const color = usePortalCssVariable("--gray-0")
  useEffect(() => {
    if (!ref.current || !depositAddress) return
    // Every dynamic option is passed on update() too, because it deep-merges:
    // a theme change (`color`) or chain change (`image`) would otherwise leave
    // the previous value painted. Level-H error correction keeps the
    // logo-covered center scannable.
    if (!qrCode.current) {
      qrCode.current = new QRCodeStyling({
        type: "canvas",
        width: 400,
        height: 400,
        margin: 0,
        data: depositAddress,
        image: selectedChainLogoUrl,
        qrOptions: { mode: "Byte", errorCorrectionLevel: "H" },
        dotsOptions: { type: "dots", color },
        cornersSquareOptions: { type: "extra-rounded", color },
        cornersDotOptions: { type: "dot", color },
        backgroundOptions: { color: "transparent" },
        imageOptions: { hideBackgroundDots: true, imageSize: 0.25, margin: 8 },
      })
      qrCode.current.append(ref.current)
    } else {
      qrCode.current.update({
        data: depositAddress,
        image: selectedChainLogoUrl,
        dotsOptions: { color },
        cornersSquareOptions: { color },
        cornersDotOptions: { color },
      })
    }
  }, [depositAddress, selectedChainLogoUrl, color])

  return (
    <DepositSubpage
      title={`Deposit ${receiveSymbol} via address`}
      onBack={() => navigate("select-method")}
    >
      <div className={styles.root}>
        <div className={styles.selectors}>
          <div className={styles.selectorGroup}>
            <span className={styles.selectorLabel}>Source asset</span>
            {/* Display-only: the address accepts any supported source, so
                nothing is selected here. */}
            <div className={styles.sourceDisplay}>
              <Image
                src={selectedAsset?.logoUrl ?? ""}
                width={24}
                height={24}
                className={styles.logo}
                classNames={{ placeholder: styles.logo }}
              />
              <span className={styles.sourceSymbol}>{selectedAsset?.symbol ?? receiveSymbol}</span>
            </div>
          </div>

          <div className={styles.selectorGroup}>
            <span className={styles.selectorLabel}>Supported network</span>
            <SourceSelector
              label="Supported network"
              options={chainOptions}
              value={activeChainId}
              onChange={setSelectedChainId}
            />
          </div>
        </div>

        <div className={styles.qrSection}>
          <div className={styles.minGroup}>
            {minLabel && <p className={styles.min}>Minimum deposit: {minLabel}</p>}

            <p className={styles.warning} role="alert">
              <IconWarningFilled size={12} aria-hidden="true" />
              Deposits below minimum or with unsupported assets will be lost.
            </p>
          </div>

          {hardError ? (
            <p className={styles.error} role="alert">
              {hardError.message}
            </p>
          ) : (
            <>
              <div className={clsx(styles.qr, { [styles.qrLoading]: !depositAddress })} ref={ref} />

              <div className={styles.addressGroup}>
                <span className={styles.address}>
                  {depositAddress || (isPending ? "Generating your deposit address…" : "")}
                </span>

                <CopyButton value={depositAddress}>
                  {({ copy, copied }) => (
                    <button
                      type="button"
                      className={clsx(styles.copy, { [styles.copied]: copied })}
                      onClick={copy}
                      disabled={!depositAddress}
                      aria-label={copied ? "Copied" : "Copy deposit address"}
                    >
                      <IconCopy size={12} aria-hidden="true" />
                      <div className={styles.labelWrapper}>
                        <span className={styles.labelCopy}>Copy address</span>
                        <span className={styles.labelCopied}>Copied!</span>
                      </div>
                    </button>
                  )}
                </CopyButton>
              </div>

              {/* Auto-advance and the resume link both rely on the polling
                  above; when it fails the user would otherwise stare at a
                  static QR with no feedback after sending. The transfer itself
                  is unaffected. */}
              {isPollError && (
                <p className={styles.error} role="alert">
                  Deposit detection is temporarily unavailable. Your transfer is unaffected; it will
                  appear once the connection recovers.
                </p>
              )}
            </>
          )}
        </div>

        {/* Explicit resume entry for an in-flight transfer from an earlier
            session; see the useActiveDeposits comment above. */}
        {!hardError && hasTransferInProgress && (
          <button type="button" className={styles.resume} onClick={() => navigate("track")}>
            View the transfer detected at this address
          </button>
        )}

        {/* No price impact or slippage control: the address is reusable and
          accepts any amount, so neither an input amount nor a user-chosen
          slippage can bind to the deposit. Slippage is a backend route policy,
          shown read-only. */}
        <div className={styles.details}>
          <Collapsible title="Transaction details" defaultOpen>
            {selectedRoute && (
              <DetailRow label="Max slippage">
                {formatSlippagePercent(selectedRoute.max_slippage_percent)}
              </DetailRow>
            )}
            <DetailRow label="Processing time">
              <ProcessingTimeValue estimate={processingTime} />
            </DetailRow>
          </Collapsible>
        </div>
      </div>
    </DepositSubpage>
  )
}

export default DepositAddress
