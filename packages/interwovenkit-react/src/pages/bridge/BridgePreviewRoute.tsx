import { Collapsible } from "radix-ui"
import { zipObj } from "ramda"
import { useAccount } from "wagmi"
import { useToggle } from "usehooks-ts"
import { IconList, IconMinus, IconWallet } from "@initia/icons-react"
import { InitiaAddress } from "@initia/utils"
import AsyncBoundary from "@/components/AsyncBoundary"
import Image from "@/components/Image"
import { useCosmosWallets } from "./data/cosmos"
import { normalizeOperation } from "./data/operation"
import { useBridgePreviewState } from "./data/tx"
import OperationItem from "./OperationItem"
import styles from "./BridgePreviewRoute.module.css"

interface Props {
  addressList: string[]
}

const BridgePreviewRoute = ({ addressList }: Props) => {
  const { values, route } = useBridgePreviewState()
  const { source_asset_denom, source_asset_chain_id, amount_in, operations } = route
  const addressMap = zipObj(route.required_chain_addresses, addressList)

  const { find } = useCosmosWallets()
  const { connector, address: connectedAddress = "" } = useAccount()

  const [showAll, toggleShowAll] = useToggle(false)
  const canToggleShowAll = operations.length > 1

  const connectedWalletIcon = (
    <Image
      src={values.cosmosWalletName ? find(values.cosmosWalletName)?.image : connector?.icon}
      width={12}
      height={12}
    />
  )

  const firstOperationProps = {
    amount: amount_in,
    denom: source_asset_denom,
    chainId: source_asset_chain_id,
    address: values.sender,
    walletIcon: connectedWalletIcon,
  }

  const getWalletIcon = (address: string) => {
    if (InitiaAddress.equals(address, connectedAddress)) return connectedWalletIcon
    return <IconWallet size={11} />
  }

  const toProps = (normalizedOperation: ReturnType<typeof normalizeOperation>) => {
    // prettier-ignore
    // @ts-expect-error Skip API's response structure is too complicated
    const { label, amount_out, denom, denom_out = denom, chain_id, from_chain_id, to_chain_id = chain_id ?? from_chain_id } = normalizedOperation
    const address = addressMap[to_chain_id]
    return {
      label: canToggleShowAll && !showAll ? undefined : label,
      amount: amount_out,
      denom: denom_out,
      chainId: to_chain_id,
      address,
      walletIcon: getWalletIcon(address),
    }
  }

  const operationProps = operations.map(normalizeOperation).map(toProps)
  const intermediateOperations = operationProps.slice(0, -1)
  const lastOperationProps = operationProps[operationProps.length - 1]

  return (
    <Collapsible.Root className={styles.root} open={showAll} onOpenChange={toggleShowAll}>
      {canToggleShowAll && (
        <div className={styles.flexEnd}>
          <Collapsible.Trigger className={styles.toggle}>
            {showAll ? (
              <>
                <IconMinus size={12} />
                <span>Hide details</span>
              </>
            ) : (
              <>
                <IconList size={12} />
                <span>Show details</span>
              </>
            )}
          </Collapsible.Trigger>
        </div>
      )}

      <div className={styles.route}>
        <OperationItem {...firstOperationProps} source />

        <Collapsible.Content className={styles.content}>
          {intermediateOperations.map((props, index) => (
            <AsyncBoundary
              suspenseFallback={<OperationItem.Placeholder {...props} />}
              errorBoundaryProps={{ fallback: <OperationItem.Placeholder {...props} /> }}
              key={index}
            >
              <OperationItem {...props} />
            </AsyncBoundary>
          ))}
        </Collapsible.Content>

        <OperationItem {...lastOperationProps} />
      </div>
    </Collapsible.Root>
  )
}

export default BridgePreviewRoute
