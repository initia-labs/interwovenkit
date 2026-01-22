import { useInterwovenKit } from "@initia/interwovenkit-react"
import styles from "./Button.module.css"

const Withdraw = () => {
  const { address, openWithdraw } = useInterwovenKit()

  if (!address) return null

  return (
    <button
      className={styles.button}
      onClick={() =>
        openWithdraw({
          denoms: [
            "uinit",
            "ibc/6490A7EAB61059BFC1CDDEB05917DD70BDF3A611654162A1A47DB930D40D8AF4",
            "move/edfcddacac79ab86737a1e9e65805066d8be286a37cb94f4884b892b0e39f954",
          ],
          chainId: "interwoven-1",
        })
      }
    >
      Withdraw
    </button>
  )
}

export default Withdraw
