import { useMutation } from "@tanstack/react-query"
import { useInterwovenKit } from "@initia/interwovenkit-react"
import { chainId } from "./data"
import styles from "./ToggleAutoSign.module.css"

const ToggleAutoSign = () => {
  const { autoSign } = useInterwovenKit()

  const enable = useMutation({
    mutationFn: () => autoSign.setup(chainId),
    onError: (error) => window.alert(error),
  })

  const disable = useMutation({
    mutationFn: () => autoSign.revoke(chainId),
    onError: (error) => window.alert(error),
  })

  if (autoSign.isEnabled[chainId]) {
    return (
      <button
        className={styles.button}
        onClick={() => disable.mutate()}
        disabled={disable.isPending}
      >
        Disable auto sign
      </button>
    )
  }

  return (
    <button
      className={styles.button}
      onClick={() => enable.mutate()}
      disabled={autoSign.isLoading || enable.isPending}
    >
      Enable auto sign
    </button>
  )
}

export default ToggleAutoSign
