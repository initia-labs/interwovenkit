import { useTransition } from "react"
import SimpleAssetList from "@/components/form/SimpleAssetList"
import { useLocalAssetOptions } from "./data/assetOptions"
import { useDepositForm, useDepositNavigate } from "./context"
import DepositStatus from "./DepositStatus"
import DepositSubpage from "./DepositSubpage"

/**
 * Entry step: pick which asset to receive from the host dApp's `openDeposit`
 * denoms, then go to the method hub. Skipped (see Deposit) when the host passed
 * a single denom.
 *
 * Deliberately overlaps with wallet/SelectLocalAsset (withdraw's picker): both
 * are thin SimpleAssetList + useLocalAssetOptions wrappers, but write to
 * different forms (hub form here, transfer form there), so two small wrappers
 * beat one parameterized component.
 */
const SelectAsset = () => {
  const { setValue } = useDepositForm()
  const navigate = useDepositNavigate()
  const { data: options, isLoading, error } = useLocalAssetOptions()
  const [isPending, startTransition] = useTransition()

  // Only reachable if /deposit was opened without localOptions — useOpenDeposit
  // (the sole entry point) rejects empty denoms — so an empty list is a caller
  // contract violation. Throw to the AsyncBoundary instead of dead-ending on a
  // silent empty screen.
  if (!options.length) {
    throw new Error("openDeposit requires at least one denom")
  }

  // The metadata lookup is best-effort with a registry-cache fallback; when
  // both fail, the list would render unlabeled buttons forever. Show loading
  // while it resolves, throw to the modal's AsyncBoundary when it never will.
  const hasUnresolvedSymbols = options.some(({ symbol }) => !symbol)
  if (error && hasUnresolvedSymbols) throw error
  if (isLoading && hasUnresolvedSymbols) return <DepositStatus>Loading...</DepositStatus>

  return (
    <DepositSubpage title="Select an asset to receive">
      <SimpleAssetList
        assets={options.map(({ denom, chain_id, symbol, logo_uri }) => ({
          denom,
          chainId: chain_id,
          symbol,
          logoUrl: logo_uri,
        }))}
        onSelect={({ denom, chainId, symbol }) => {
          setValue("receiveSymbol", symbol)
          setValue("receiveDenom", denom)
          setValue("receiveChainId", chainId)

          // Deferred navigation: keeps showing this page while the next page's
          // suspense resolves, preventing the AsyncBoundary "Loading..." flash.
          startTransition(() => {
            navigate("select-method")
          })
        }}
        isBusy={isPending}
      />
    </DepositSubpage>
  )
}

export default SelectAsset
