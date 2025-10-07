import AssetOnChainButton from "@/components/form/AssetOnChainButton"
import ModalTrigger from "@/components/ModalTrigger"
import { useSkipAsset } from "./data/assets"
import { useSkipChain } from "./data/chains"
import { useBridgeForm } from "./data/form"
import SelectChainAsset from "./SelectChainAsset"

const SelectedChainAsset = ({ type }: { type: "src" | "dst" }) => {
  const chainIdKey = type === "src" ? "srcChainId" : "dstChainId"
  const denomKey = type === "src" ? "srcDenom" : "dstDenom"
  const title =
    type === "src" ? "Select source chain and asset" : "Select destination chain and asset"

  const { watch } = useBridgeForm()
  const chainId = watch(chainIdKey)
  const denom = watch(denomKey)

  const chain = useSkipChain(chainId)
  const asset = useSkipAsset(denom, chainId)

  return (
    <ModalTrigger
      title={title}
      content={(close) => <SelectChainAsset type={type} afterSelect={close} />}
    >
      <AssetOnChainButton
        asset={{
          denom: asset.denom,
          decimals: asset.decimals ?? 0,
          symbol: asset.symbol,
          logoUrl: asset.logo_uri ?? "",
        }}
        chain={{
          chainId: chain.chain_id,
          name: chain.pretty_name || chain.chain_name,
          logoUrl: chain.logo_uri ?? "",
        }}
      />
    </ModalTrigger>
  )
}

export default SelectedChainAsset
