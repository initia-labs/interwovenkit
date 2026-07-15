import { useQueryClient } from "@tanstack/react-query"
import { IconBuy, IconQrCode, IconWallet } from "@initia/icons-react"
import { truncate } from "@initia/utils"
import AsyncBoundary from "@/components/AsyncBoundary"
import Button from "@/components/Button"
import Footer from "@/components/Footer"
import { useConfig } from "@/data/config"
import { useConnectedWalletIcon } from "@/hooks/useConnectedWalletIcon"
import { useLocationState } from "@/lib/router"
import { useHexAddress } from "@/public/data/hooks"
import { depositQueryKeys, useOnramperEnabled } from "./data/api"
import type { DepositLocationState } from "./data/assetOptions"
import { useDepositRoutes } from "./data/assets"
import CashMethodSubtext, { CASH_SUBTEXT_FALLBACK } from "./onramp/CashMethodSubtext"
import { usePrefetchOnramperGeoDefaults } from "./onramp/data/onramper"
import { useDepositForm, useDepositNavigate, useSelectDepositMethod } from "./context"
import DepositMethodList, { type DepositMethodSection } from "./DepositMethodList"
import DepositSubpage from "./DepositSubpage"

/** Deposit API availability of the address/onramp methods for the receive
 * asset. `loading` renders them disabled with static copy while the route
 * check suspends behind the boundary below. */
type CryptoAvailability =
  | { status: "loading" }
  | { status: "unavailable"; reason: string }
  | { status: "available" }

/** The hub's method ids: `wallet` opens the embedded transfer flow directly;
 * `address`/`onramp` select the deposit method (see useSelectDepositMethod). */
type HubMethodId = "wallet" | "address" | "onramp"

/** The method list for a known crypto availability (see CryptoAvailability). */
const MethodSections = ({ availability }: { availability: CryptoAvailability }) => {
  const onramperEnabled = useOnramperEnabled()
  const navigate = useDepositNavigate()
  const selectMethod = useSelectDepositMethod()
  const hexAddress = useHexAddress()
  const walletIcon = useConnectedWalletIcon()

  // The Buy form suspends on the geo-defaults lookup; warming it here (the
  // screen the user reads before picking cash) keeps that entry instant.
  usePrefetchOnramperGeoDefaults()

  // The deposit-address-fed methods credit the connected wallet from any
  // supported source, so they can't honor a host-provided recipientAddress or
  // srcOptions allowlist (only the wallet method applies those). Offering them
  // would break the host's openDeposit contract — funds to the wrong account,
  // or deposits from excluded sources — so they are disabled with a reason.
  const { remoteOptions = [], recipientAddress } = useLocationState<DepositLocationState>()
  const hostConstraintReason =
    recipientAddress || remoteOptions.length > 0
      ? "Unavailable for this deposit request"
      : undefined

  // Names the connected wallet with its truncated hex address so the user can
  // recognize it (e.g. "Your connected wallet · 0xA7…a2FA").
  const walletSubtext = `Your connected wallet · ${truncate(hexAddress, [4, 4])}`

  const cryptoDisabled = availability.status !== "available" || !!hostConstraintReason
  const cryptoReason =
    hostConstraintReason ??
    (availability.status === "unavailable" ? availability.reason : undefined)

  const sections: DepositMethodSection<HubMethodId>[] = [
    {
      label: "Crypto",
      methods: [
        // "Deposit via wallet" uses the connected wallet's own icon (IconWallet fallback).
        {
          id: "wallet",
          title: "Deposit via wallet",
          subtext: walletSubtext,
          Icon: IconWallet,
          iconUrl: walletIcon,
        },
        // The address subtext completes the contrast with the wallet method:
        // anyone can send to the deposit address, no connected-wallet signature.
        {
          id: "address",
          title: "Deposit via address",
          subtext: cryptoReason ?? "From any wallet or exchange · No limit",
          Icon: IconQrCode,
          disabled: cryptoDisabled,
        },
      ],
    },
    {
      label: "Cash",
      methods: [
        {
          id: "onramp",
          title: "Buy with cash/card",
          // Subtext priority: Deposit API reason, then Onramper config gate,
          // then the live limit. The limit gets its own boundary so a slow or
          // failing Onramper lookup degrades to static copy instead of
          // suspending the whole screen; a misconfigured key still fails loudly
          // inside the cash flow.
          subtext: cryptoReason ? (
            cryptoReason
          ) : !onramperEnabled ? (
            "Unavailable on this app"
          ) : availability.status === "loading" ? (
            CASH_SUBTEXT_FALLBACK
          ) : (
            <AsyncBoundary
              errorBoundaryProps={{ fallbackRender: () => CASH_SUBTEXT_FALLBACK }}
              suspenseFallback={CASH_SUBTEXT_FALLBACK}
            >
              <CashMethodSubtext />
            </AsyncBoundary>
          ),
          Icon: IconBuy,
          disabled: cryptoDisabled || !onramperEnabled,
        },
      ],
    },
  ]

  return (
    <DepositMethodList
      sections={sections}
      onSelect={(id) => {
        // "Deposit via wallet" renders the existing Router API transfer flow as
        // the `wallet` page of this hub, scoped to the selected receive asset.
        switch (id) {
          case "wallet":
            navigate("wallet")
            break
          case "address":
          case "onramp":
            selectMethod(id)
            break
        }
      }}
    />
  )
}

/**
 * Resolves crypto availability from the Deposit API's `config/assets`: the
 * address and onramp methods only work when it lists a route feeding the
 * receive asset. Suspends, so it renders behind the boundary below.
 */
const GatedMethodSections = () => {
  const { watch } = useDepositForm()
  const receiveDenom = watch("receiveDenom")
  const receiveChainId = watch("receiveChainId")
  const routes = useDepositRoutes(receiveChainId, receiveDenom)

  return (
    <MethodSections
      availability={
        routes.length > 0
          ? { status: "available" }
          : { status: "unavailable", reason: "Not supported for this asset" }
      }
    />
  )
}

/** Deposit method hub: via wallet (embedded transfer flow), via address
 * (Deposit API deposit address), with cash/card (Onramper purchase). Wallet is
 * always offered; the other two are gated on the Deposit API (URL + a route for
 * the asset), onramp additionally on the Onramper config (URL + key).
 * Unavailable methods stay visible but disabled, with the reason as subtext. */
const SelectDepositMethod = () => {
  const { depositApiUrl } = useConfig()
  const { watch } = useDepositForm()
  const { localOptions = [] } = useLocationState<DepositLocationState>()
  const navigate = useDepositNavigate()
  const queryClient = useQueryClient()
  const receiveSymbol = watch("receiveSymbol")

  return (
    <DepositSubpage
      title={receiveSymbol ? `Deposit ${receiveSymbol}` : "Deposit"}
      // With a single local asset the picker was skipped, so there is nothing
      // to go back to.
      onBack={localOptions.length === 1 ? undefined : () => navigate("select-asset")}
    >
      {!depositApiUrl ? (
        // No Deposit API on this network (e.g. testnet): don't run the
        // route query at all.
        <MethodSections
          availability={{ status: "unavailable", reason: "Unavailable on this network" }}
        />
      ) : (
        // Local boundary so the suspending route check degrades only the
        // affected methods, keeping "Deposit via wallet" usable while the
        // Deposit API's `config/assets` loads or fails.
        <AsyncBoundary
          errorBoundaryProps={{
            // The fallback hides the cause; log it for diagnosis.
            // eslint-disable-next-line no-console
            onError: (error) => console.error(error),
            fallbackRender: ({ resetErrorBoundary }) => {
              // Reset the errored suspense query with the boundary, or
              // remount rethrows the cached error.
              const retry = () => {
                queryClient.resetQueries({ queryKey: depositQueryKeys.assets.queryKey })
                resetErrorBoundary()
              }
              return (
                <>
                  <MethodSections
                    availability={{ status: "unavailable", reason: "Unavailable right now" }}
                  />
                  <Footer>
                    <Button.White onClick={retry}>Retry</Button.White>
                  </Footer>
                </>
              )
            },
          }}
          suspenseFallback={<MethodSections availability={{ status: "loading" }} />}
        >
          <GatedMethodSections />
        </AsyncBoundary>
      )}
    </DepositSubpage>
  )
}

export default SelectDepositMethod
