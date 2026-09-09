import styles from "./StayConnected.module.css"

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
