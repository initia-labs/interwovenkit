import { useEffect, useEffectEvent, useRef, useState } from "react"
import { useConfig } from "@/data/config"
import { useDeriveWallet } from "./data/wallet"
import styles from "./StayConnected.module.css"

interface PreferenceState {
  scope?: string
  value: boolean
  storageUnavailable: boolean
}

// Kept with the control so all three approval screens share one preference lifecycle.
// eslint-disable-next-line react-refresh/only-export-components
export function useStayConnectedPreference(chainId: string, owner: string | undefined) {
  const { autoSignStorage } = useConfig()
  const { getStayConnected } = useDeriveWallet()
  const scope = JSON.stringify([autoSignStorage, chainId, owner])
  const selectedScopeRef = useRef<string | undefined>(undefined)
  const [preference, setPreference] = useState<PreferenceState>({
    value: autoSignStorage !== "memory",
    storageUnavailable: false,
  })
  const loadPreference = useEffectEvent(() => getStayConnected(chainId))

  useEffect(() => {
    let active = true
    selectedScopeRef.current = undefined

    if (autoSignStorage === "memory") {
      void Promise.resolve().then(() => {
        if (active) setPreference({ scope, value: false, storageUnavailable: false })
      })
    } else {
      void loadPreference()
        .then((value) => {
          if (!active) return
          setPreference((current) => ({
            scope,
            value: selectedScopeRef.current === scope ? current.value : value,
            storageUnavailable: false,
          }))
        })
        .catch(() => {
          if (!active) return
          setPreference((current) => ({
            scope,
            value: selectedScopeRef.current === scope ? current.value : false,
            storageUnavailable: true,
          }))
        })
    }

    return () => {
      active = false
    }
  }, [autoSignStorage, scope])

  const isCurrent = preference.scope === scope
  return {
    stayConnected: autoSignStorage === "memory" ? false : preference.value,
    setStayConnected: (value: boolean) => {
      selectedScopeRef.current = scope
      setPreference((current) => ({
        scope,
        value,
        storageUnavailable: current.scope === scope && current.storageUnavailable,
      }))
    },
    isLoadingPreference: autoSignStorage !== "memory" && !isCurrent,
    isStorageUnavailable: isCurrent && preference.storageUnavailable,
  }
}

interface Props {
  checked: boolean
  disabled?: boolean
  onChange: (checked: boolean) => void
}

const StayConnected = ({ checked, disabled, onChange }: Props) => {
  return (
    <label className={styles.control}>
      <input
        type="checkbox"
        aria-label="Stay connected"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span>
        <strong>Stay connected</strong>
        <small>
          {checked
            ? "Keep auto-signing available on this browser after you close this tab."
            : "Keep auto-signing available in this tab, including reloads."}
        </small>
      </span>
    </label>
  )
}

export default StayConnected
