import clsx from "clsx"
import { useAccount, useSwitchChain, useWatchAsset } from "wagmi"
import { useMutation } from "@tanstack/react-query"
import { IconCheck, IconPlus } from "@initia/icons-react"
import { useNavigate } from "@/lib/router"
import { useConfig } from "@/data/config"
import { useDefaultChain, type NormalizedChain } from "@/data/chains"
import { useAsset } from "@/data/assets"
import Image from "@/components/Image"
import styles from "./AssetActions.module.css"

const AssetActions = ({ denom, chain }: { denom: string; chain: NormalizedChain }) => {
  const navigate = useNavigate()
  const { defaultChainId } = useConfig()
  const { evm_chain_id } = useDefaultChain()
  const { address = "", symbol, decimals, logoUrl: image } = useAsset(denom, chain)
  const { connector } = useAccount()
  const { switchChainAsync } = useSwitchChain()
  const { watchAssetAsync } = useWatchAsset()
  const { chainId } = chain

  const send = () => {
    navigate("/send", { denom, chain })
  }

  const bridge = () => {
    navigate("/bridge", { srcChainId: chainId, srcDenom: denom })
  }

  const addAsset = useMutation({
    mutationFn: async () => {
      await switchChainAsync({ chainId: Number(evm_chain_id) })
      return watchAssetAsync({ type: "ERC20", options: { address, symbol, decimals, image } })
    },
  })

  return (
    <nav className={styles.actions}>
      <button
        className={styles.button}
        onClick={send}
        data-amp-track-name="Send_asset_button_clicked"
        data-amp-track-denom={denom}
        data-amp-track-chainid={chain.chainId}
      >
        Send
      </button>

      <button
        className={styles.button}
        onClick={bridge}
        data-amp-track-name="Bridge_swap_asset_button_clicked"
        data-amp-track-denom={denom}
        data-amp-track-chainid={chain.chainId}
      >
        Bridge/Swap
      </button>

      {chainId === defaultChainId && !!address && (
        <button
          className={clsx(styles.button, styles.add)}
          onClick={() => addAsset.mutate()}
          disabled={addAsset.isPending || addAsset.data}
        >
          {!addAsset.data ? <IconPlus size={10} /> : <IconCheck size={10} />}
          <Image src={connector?.icon} width={16} height={16} />
        </button>
      )}
    </nav>
  )
}

export default AssetActions
