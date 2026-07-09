import { useInterwovenKit } from "@initia/interwovenkit-react"
import styles from "./Button.module.css"

const INIT_DENOM = "uinit"
const USDC_DENOM = "ibc/6490A7EAB61059BFC1CDDEB05917DD70BDF3A611654162A1A47DB930D40D8AF4"
const ETH_DENOM = "move/edfcddacac79ab86737a1e9e65805066d8be286a37cb94f4884b892b0e39f954"
const IUSD_DENOM = "move/6c69733a9e722f3660afb524f89fce957801fa7e4408b8ef8fe89db9627b570e"

const DENOMS = [INIT_DENOM, USDC_DENOM, ETH_DENOM, IUSD_DENOM]

const CHAIN_ID = "interwoven-1"

const Deposit = () => {
  const { address, openDeposit } = useInterwovenKit()

  if (!address) return null

  return (
    <>
      <button
        className={styles.button}
        onClick={() => openDeposit({ denoms: DENOMS, chainId: CHAIN_ID })}
      >
        Deposit
      </button>
      <button
        className={styles.button}
        onClick={() => openDeposit({ denoms: [INIT_DENOM], chainId: CHAIN_ID })}
      >
        Deposit INIT
      </button>
      <button
        className={styles.button}
        onClick={() => openDeposit({ denoms: [IUSD_DENOM], chainId: CHAIN_ID })}
      >
        Deposit iUSD
      </button>
    </>
  )
}

export default Deposit
