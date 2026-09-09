import AssetOptions from "@/components/form/AssetOptions"
import { LocalStorageKey } from "@/data/constants"
import { useDepositForm, useDepositNavigate } from "../context"
import DepositSubpage from "../DepositSubpage"
import { useOnramperSupported } from "./data/onramper"
import styles from "./SelectFiat.module.css"

/** Fiat currency picker: the Onramper supported-fiat list, searchable
 * by code or name, rendered through the shared AssetOptions list. The currency
 * icon comes from Onramper, so the default asset row renders it directly. */
const SelectFiat = () => {
  const { setValue } = useDepositForm()
  const navigate = useDepositNavigate()
  const { fiat } = useOnramperSupported()

  return (
    <DepositSubpage title="Select fiat currency" onBack={() => navigate("onramp")}>
      {/* scroll={false}: AssetOptions scrolls internally so the search box
          stays put; the list only bounds the height. */}
      <DepositSubpage.List scroll={false}>
        <AssetOptions
          assets={fiat.map((entry) => ({
            denom: entry.id,
            symbol: entry.code,
            name: entry.name,
            decimals: 0,
            logoUrl: entry.icon,
          }))}
          searchKeys={["symbol", "name"]}
          placeholder="Search by currency"
          emptyMessage="No currencies"
          listClassName={styles.list}
          onSelect={(id) => {
            setValue("fiatId", id)
            // Remember explicit picks only, as the next session's default
            // (buildDepositDefaultValues). The fiat anchor in OnrampFields
            // (resolveFiatAnchor: an unsupported remembered fiat, or the
            // geolocated recommendation replacing the static default) stays
            // unpersisted on purpose, mirroring the payment method's
            // persistence rule.
            localStorage.setItem(LocalStorageKey.ONRAMP_FIAT_ID, id)
            navigate("onramp")
          }}
        />
      </DepositSubpage.List>
    </DepositSubpage>
  )
}

export default SelectFiat
