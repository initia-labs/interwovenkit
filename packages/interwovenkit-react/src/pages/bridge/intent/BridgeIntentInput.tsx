import BigNumber from "bignumber.js"
import clsx from "clsx"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { IconArrowRight } from "@initia/icons-react"
import { formatAmount, toBaseUnit } from "@initia/utils"
import AnimatedHeight from "@/components/AnimatedHeight"
import Image from "@/components/Image"
import { useSkipBalance } from "../data/balance"
import { useBridgeForm } from "../data/form"
import { parseBridgeIntent } from "./parseBridgeIntent"
import type { ResolvedIntent, ResolvedSlot } from "./useResolveIntent"
import { useResolveIntent } from "./useResolveIntent"
import { useSuggestion } from "./useSuggestion"
import styles from "./BridgeIntentInput.module.css"

const EXAMPLES = [
  "USDC from Ethereum to Initia",
  "100 USDC from Ethereum to iUSD on Cabal",
  "ETH from Arbitrum to INIT on Initia",
]

interface Props {
  open: boolean
  confirmed: boolean
  onOpen: () => void
  onApply: (resolved: ResolvedIntent) => void
  onClose: () => void
}

function SlotChip({
  slot,
  label,
  hideAsset,
}: {
  slot: ResolvedSlot
  label: string
  hideAsset?: boolean
}) {
  if (!slot.assetSymbol && !slot.chainName) {
    return <span className={clsx(styles.chip, styles.chipMissing)}>{label}</span>
  }

  const showAsset = !hideAsset && slot.assetSymbol
  const showMissingAsset = !showAsset && !!slot.chainName

  return (
    <span className={styles.chip}>
      {showAsset && (
        <>
          {slot.logoUrl && (
            <Image src={slot.logoUrl} alt={slot.assetSymbol} width={14} height={14} logo />
          )}
          <span>{slot.assetSymbol}</span>
        </>
      )}
      {slot.chainName ? (
        <>
          {showAsset && <span className={styles.separator}>on</span>}
          {slot.chainLogoUrl && (
            <Image src={slot.chainLogoUrl} alt={slot.chainName} width={14} height={14} logo />
          )}
          <span>{slot.chainName}</span>
          {showMissingAsset && (
            <span className={clsx(styles.separator, styles.chipMissing)}>Asset?</span>
          )}
        </>
      ) : (
        showAsset && <span className={clsx(styles.separator, styles.chipMissing)}>Chain?</span>
      )}
    </span>
  )
}

const ReturnIcon = () => (
  <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
    <path
      d="M10.5 3v3.5a2 2 0 0 1-2 2H4m0 0 2-2m-2 2 2 2"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
)

function isEnterKey(event: Pick<React.KeyboardEvent, "key" | "code">): boolean {
  return event.key === "Enter" || event.code === "Enter" || event.code === "NumpadEnter"
}

const BridgeIntentInput = ({ open, confirmed, onOpen, onApply, onClose }: Props) => {
  const [value, setValue] = useState("")
  const [placeholderIndex, setPlaceholderIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  const parsed = useMemo(() => parseBridgeIntent(value), [value])
  const resolved = useResolveIntent(parsed)
  const suggestion = useSuggestion(value)

  const sender = useBridgeForm().watch("sender")
  const srcBalance = useSkipBalance(
    sender ?? "",
    resolved.src.chainId ?? "",
    resolved.src.denom ?? "",
  )

  const { decimals } = resolved.src
  const hasBalance = !!srcBalance?.amount && decimals != null
  const isInsufficient =
    hasBalance &&
    !!resolved.amount &&
    BigNumber(toBaseUnit(resolved.amount, { decimals: decimals! })).gt(srcBalance!.amount)

  const hasContent = value.trim().length > 0
  const sameDstAsset =
    resolved.src.assetSymbol &&
    resolved.dst.assetSymbol &&
    resolved.src.assetSymbol.toLowerCase() === resolved.dst.assetSymbol.toLowerCase()

  useEffect(() => {
    if (open) {
      const id = setTimeout(() => inputRef.current?.focus(), 120)
      return () => clearTimeout(id)
    }
    inputRef.current?.blur()
    setValue("")
  }, [open])

  useEffect(() => {
    if (hasContent || !open) return
    const id = setInterval(() => {
      setPlaceholderIndex((i) => (i + 1) % EXAMPLES.length)
    }, 3000)
    return () => clearInterval(id)
  }, [hasContent, open])

  const acceptSuggestion = useCallback(() => {
    if (suggestion) {
      setValue(suggestion)
      return true
    }
    return false
  }, [suggestion])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!open) return

      if (e.key === "Tab" && suggestion) {
        e.preventDefault()
        e.stopPropagation()
        acceptSuggestion()
        return
      }
      if (isEnterKey(e)) {
        e.preventDefault()
        e.stopPropagation()
        if (resolved.isComplete) onApply(resolved)
      }
      if (e.key === "Escape") {
        e.preventDefault()
        e.stopPropagation()
        onClose()
      }
    },
    [open, resolved, suggestion, acceptSuggestion, onApply, onClose],
  )

  const preventImplicitSubmit = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    const target = e.target
    if (!(target instanceof HTMLElement)) return
    if (target.dataset.intentInput !== "true") return
    if (isEnterKey(e)) e.preventDefault()
  }, [])

  return (
    <div className={styles.wrapper} onKeyDownCapture={preventImplicitSubmit}>
      <div
        className={clsx(styles.bar, !open && styles.barClosed, confirmed && styles.barConfirmed)}
        onClick={!open ? onOpen : undefined}
        onKeyDown={(e) => {
          if (!open && (e.key === "Enter" || e.key === " ")) {
            e.preventDefault()
            onOpen()
          }
        }}
        role={!open ? "button" : undefined}
        tabIndex={!open ? 0 : -1}
      >
        <span className={clsx(styles.trigger, open && styles.triggerHidden)}>
          <svg
            width="14"
            height="14"
            viewBox="0 0 16 16"
            fill="none"
            className={styles.triggerIcon}
          >
            <path
              d="M9 2L4 9h4l-1 5 5-7H8l1-5z"
              stroke="currentColor"
              strokeWidth="1.3"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          Try &ldquo;10 USDC from Ethereum to iUSD on Initia&rdquo;
        </span>

        <div className={clsx(styles.inputContent, open && styles.inputContentVisible)}>
          <div className={styles.inputWrapper}>
            <input
              ref={inputRef}
              type="text"
              className={styles.input}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={handleKeyDown}
              data-intent-input="true"
              autoComplete="off"
              spellCheck={false}
              tabIndex={open ? 0 : -1}
            />
            {!hasContent && (
              <span key={placeholderIndex} className={styles.placeholder}>
                {EXAMPLES[placeholderIndex]}
              </span>
            )}
            {suggestion && (
              <input
                className={styles.ghost}
                value={suggestion}
                readOnly
                tabIndex={-1}
                aria-hidden
              />
            )}
          </div>

          {suggestion && <span className={styles.tabHint}>Tab</span>}

          {confirmed ? (
            <span className={styles.confirmIcon}>
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <path
                  d="M2.5 6.5L5 9l4.5-6"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
          ) : resolved.isComplete ? (
            <button
              type="button"
              className={styles.submitButton}
              onClick={() => onApply(resolved)}
              title="Apply (Enter)"
            >
              <ReturnIcon />
            </button>
          ) : (
            <button
              type="button"
              className={styles.closeButton}
              onClick={onClose}
              title="Close (Esc)"
            >
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                <path
                  d="M1 1l8 8M9 1l-8 8"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          )}
        </div>
      </div>

      <AnimatedHeight>
        {open && hasContent && (
          <div className={styles.feedback}>
            <div className={styles.feedbackRoute}>
              {resolved.amount && (
                <span className={clsx(styles.amount, isInsufficient && styles.amountInsufficient)}>
                  {resolved.amount}
                </span>
              )}
              <SlotChip slot={resolved.src} label="Source?" />
              <IconArrowRight size={10} className={styles.arrow} />
              <SlotChip slot={resolved.dst} label="Destination?" hideAsset={!!sameDstAsset} />
            </div>
            {isInsufficient && (
              <span className={styles.insufficientHint}>
                Exceeds balance ({formatAmount(srcBalance!.amount, { decimals: decimals! })}{" "}
                available)
              </span>
            )}
            {resolved.errorMessage && (
              <span className={styles.insufficientHint}>{resolved.errorMessage}</span>
            )}
          </div>
        )}
      </AnimatedHeight>
    </div>
  )
}

export default BridgeIntentInput
