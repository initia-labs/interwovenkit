import { useMutation } from "@tanstack/react-query"
import { useInterwovenKit } from "@initia/interwovenkit-react"
import { chainId } from "./data"
import styles from "./Button.module.css"

const ToggleAutoSign = () => {
  const { autoSign, address } = useInterwovenKit()

  const enable = useMutation({
    mutationFn: () => autoSign.enable(chainId),
    onError: (error) => window.alert(error),
  })

  const disable = useMutation({
    mutationFn: () => autoSign.disable(chainId),
    onError: (error) => window.alert(error),
  })

  if (!address) return null

  if (autoSign.isEnabledByChain[chainId]) {
    return (
      <button
        className={styles.button}
        onClick={() => disable.mutate()}
        disabled={autoSign.isLoading || disable.isPending}
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
