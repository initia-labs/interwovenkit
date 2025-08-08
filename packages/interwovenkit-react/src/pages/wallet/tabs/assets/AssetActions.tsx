import { useState } from "react"
import { useAccount, useSwitchChain, useWatchAsset } from "wagmi"
import { DropdownMenu } from "radix-ui"
import { useMutation } from "@tanstack/react-query"
import { IconCheck, IconPlus, IconSwap, IconArrowRight } from "@initia/icons-react"
import { useNavigate } from "@/lib/router"
import { usePortal } from "@/public/app/PortalContext"
import { useConfig } from "@/data/config"
import { useDefaultChain, type NormalizedChain } from "@/data/chains"
import { useAsset } from "@/data/assets"
import Image from "@/components/Image"
import styles from "./AssetActions.module.css"

interface AssetActionsProps {
  denom: string
  chain: NormalizedChain
  children: React.ReactNode
  isUnsupported?: boolean
}

const AssetActions = ({ denom, chain, children, isUnsupported }: AssetActionsProps) => {
  const [open, setOpen] = useState(false)
  const navigate = useNavigate()
  const { defaultChainId } = useConfig()
  const { evm_chain_id } = useDefaultChain()
  const { address = "", symbol, decimals, logoUrl: image } = useAsset(denom, chain)
  const { connector } = useAccount()
  const { switchChainAsync } = useSwitchChain()
  const { watchAssetAsync } = useWatchAsset()
  const { chainId } = chain

  const send = () => {
    setOpen(false)
    // Note: This is a workaround to prevent the navigation before the dropdown is closed
    setTimeout(() => navigate("/send", { denom, chain }))
  }

  const bridge = () => {
    setOpen(false)
    // Note: This is a workaround to prevent the navigation before the dropdown is closed
    setTimeout(() => navigate("/bridge", { srcChainId: chainId, srcDenom: denom }))
  }

  const addAsset = useMutation({
    mutationFn: async () => {
      await switchChainAsync({ chainId: Number(evm_chain_id) })
      return watchAssetAsync({ type: "ERC20", options: { address, symbol, decimals, image } })
    },
  })

  return (
    <DropdownMenu.Root open={open} onOpenChange={setOpen}>
      <DropdownMenu.Trigger asChild>{children}</DropdownMenu.Trigger>

      <DropdownMenu.Portal container={usePortal()}>
        <DropdownMenu.Content className={styles.dropdown} side="bottom" sideOffset={-6} align="end">
          <DropdownMenu.Item className={styles.dropdownItem} onSelect={send}>
            <IconArrowRight size={16} />
            <span>Send</span>
          </DropdownMenu.Item>
          <DropdownMenu.Item
            className={styles.dropdownItem}
            onSelect={bridge}
            disabled={isUnsupported}
          >
            <IconSwap size={16} />
            <span>Bridge/Swap</span>
          </DropdownMenu.Item>
          {chainId === defaultChainId && !!address && (
            <DropdownMenu.Item
              className={styles.dropdownItem}
              onSelect={() => addAsset.mutate()}
              disabled={addAsset.isPending || addAsset.data}
            >
              {!addAsset.data ? <IconPlus size={10} /> : <IconCheck size={10} />}
              <span>Add to Wallet</span>
              <Image src={connector?.icon} width={16} height={16} />
            </DropdownMenu.Item>
          )}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}

export default AssetActions
