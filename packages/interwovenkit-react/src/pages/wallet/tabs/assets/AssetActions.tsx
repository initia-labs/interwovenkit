import { useState, type PropsWithChildren, type ReactElement } from "react"
import { useChainId, useSwitchChain, useWatchAsset } from "wagmi"
import { Menu } from "@base-ui-components/react"
import { useMutation } from "@tanstack/react-query"
import { IconCheck, IconPlus, IconSwap, IconArrowRight } from "@initia/icons-react"
import { useNavigate } from "@/lib/router"
import { useConfig } from "@/data/config"
import { useDefaultChain } from "@/data/chains"
import type { PortfolioAssetItem } from "@/data/portfolio"
import { useNotification } from "@/public/app/NotificationContext"
import { useScrollableRef } from "../ScrollableContext"
import styles from "./AssetActions.module.css"

interface Props {
  asset: PortfolioAssetItem
}

const AssetActions = ({ asset, children }: PropsWithChildren<Props>) => {
  const { denom, decimals, symbol, logoUrl, unsupported, address, chain } = asset
  const { chainId } = chain
  const [open, setOpen] = useState(false)
  const navigate = useNavigate()
  const scrollableRef = useScrollableRef()
  const { showNotification } = useNotification()
  const { defaultChainId } = useConfig()
  const { evm_chain_id } = useDefaultChain()
  const wagmiChainId = useChainId()
  const { switchChainAsync } = useSwitchChain()
  const { watchAssetAsync } = useWatchAsset()

  const send = () => {
    setOpen(false)
    navigate("/send", { denom, chain })
  }

  const bridge = () => {
    setOpen(false)
    navigate("/bridge", { srcChainId: chainId, srcDenom: denom, quantity: "" })
  }

  const addAsset = useMutation({
    mutationFn: async () => {
      if (!address) throw new Error("Address is required")
      const image = logoUrl
      await switchChainAsync({ chainId: Number(evm_chain_id) })
      return watchAssetAsync({ type: "ERC20", options: { address, symbol, decimals, image } })
    },
    onSuccess: () => {
      showNotification({
        type: "success",
        title: "Asset added",
        description: "Asset added to wallet",
      })
    },
    onError: (error) => {
      showNotification({
        type: "error",
        title: "Asset addition failed",
        description: error.message,
      })
    },
  })

  return (
    <Menu.Root open={open} onOpenChange={setOpen} modal={false}>
      <Menu.Trigger render={children as ReactElement<Record<string, unknown>>} />

      <Menu.Portal container={scrollableRef.current}>
        <Menu.Positioner side="bottom" sideOffset={-6} align="end">
          <Menu.Popup className={styles.popup}>
            <Menu.Item className={styles.item} onClick={send}>
              <IconArrowRight size={16} />
              <span>Send</span>
            </Menu.Item>
            <Menu.Item className={styles.item} onClick={bridge} disabled={unsupported}>
              <IconSwap size={16} />
              <span>Bridge/Swap</span>
            </Menu.Item>
            {chainId === defaultChainId && evm_chain_id === wagmiChainId && !!address && (
              <Menu.Item
                className={styles.item}
                onClick={() => addAsset.mutate()}
                disabled={addAsset.isPending || addAsset.data}
              >
                {!addAsset.data ? <IconPlus size={16} /> : <IconCheck size={16} />}
                <span>Add to Wallet</span>
              </Menu.Item>
            )}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  )
}

export default AssetActions
