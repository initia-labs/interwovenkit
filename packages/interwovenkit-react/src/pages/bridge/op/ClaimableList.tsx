import { formatAmount } from "@initia/utils"
import { useFindChain, useLayer1 } from "@/data/chains"
import { useFindAsset } from "@/data/assets"
import Image from "@/components/Image"
import PlainModalContent from "@/components/PlainModalContent"
import type { ReminderDetails } from "./reminder"
import styles from "./ClaimableList.module.css"

interface Props {
  list: ReminderDetails[]
  onNavigate: () => void
  onDismiss: () => void
}

const ClaimableList = ({ list, onNavigate, onDismiss }: Props) => {
  const layer1 = useLayer1()
  const findChain = useFindChain()
  const findAsset = useFindAsset(layer1)

  return (
    <PlainModalContent
      title="Ready to claim"
      primaryButton={{ label: "View withdrawal status", onClick: onNavigate }}
      secondaryButton={{ label: "Do not show again", onClick: onDismiss }}
    >
      <div className={styles.list}>
        {list
          .toSorted((a, b) => a.chainId.localeCompare(b.chainId))
          .map(({ txHash, chainId, amount, denom }) => {
            const chain = findChain(chainId)
            const { decimals, symbol } = findAsset(denom)
            const formattedAmount = formatAmount(amount, { decimals })
            return (
              <div className={styles.row} key={txHash}>
                <div className={styles.dt}>
                  <Image src={chain.logoUrl} width={16} height={16} />
                  <span>{chain.name}</span>
                </div>

                <span className={styles.asset}>
                  {formattedAmount} {symbol}
                </span>
              </div>
            )
          })}
      </div>
    </PlainModalContent>
  )
}

export default ClaimableList
