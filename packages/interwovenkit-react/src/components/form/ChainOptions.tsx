import clsx from "clsx"
import type { PropsWithChildren } from "react"
import Indicator from "../Indicator"
import WidgetTooltip from "../WidgetTooltip"
import Image from "../Image"
import type { BaseChain } from "./types"
import styles from "./ChainOptions.module.css"

interface Props {
  label?: string
  chains: BaseChain[]
  value: string
  onSelect: (chainId: string) => void
  getShowIndicator?: (chainId: string) => boolean
  getAmplitudeEvent?: (chainId: string) => { name: string; details?: Record<string, unknown> }
}

const ChainOptions = ({
  label,
  chains,
  value,
  onSelect,
  getShowIndicator,
  getAmplitudeEvent,
}: Props) => {
  return (
    <div>
      {label && <h2 className={styles.title}>{label}</h2>}
      <div className={styles.grid}>
        {chains.map(({ chainId, name, logoUrl }) => (
          <Indicator
            offset={-2}
            disabled={!getShowIndicator?.(chainId)}
            className={styles.item}
            key={chainId}
          >
            <WidgetTooltip
              label={name}
              disableHoverableContent
              amplitudeEvent={getAmplitudeEvent?.(chainId)}
            >
              <button
                type="button"
                className={clsx(styles.button, { [styles.active]: chainId === value })}
                onClick={() => onSelect(chainId)}
              >
                <Image src={logoUrl} width={28} height={28} circle />
              </button>
            </WidgetTooltip>
          </Indicator>
        ))}
      </div>
    </div>
  )
}

const ChainOptionsStack = ({ children }: PropsWithChildren) => {
  return <div className={styles.stack}>{children}</div>
}

ChainOptions.Stack = ChainOptionsStack

export default ChainOptions
