import clsx from "clsx"
import { IconChevronDown } from "@initia/icons-react"
import { useChain } from "@/data/chains"
import ModalTrigger from "@/components/ModalTrigger"
import Image from "@/components/Image"
import AddedChainList from "../../components/AddedChainList"
import styles from "./SelectChain.module.css"

interface Props {
  value: string
  onSelect: (chainId: string) => void
}

const SelectChain = ({ value, onSelect }: Props) => {
  const { logoUrl, name } = useChain(value)

  return (
    <ModalTrigger
      title="Select rollup"
      content={(close) => (
        <AddedChainList
          onSelect={(chainId) => {
            onSelect(chainId)
            close()
          }}
        />
      )}
      className={clsx("input", styles.button)}
    >
      <Image src={logoUrl} width={16} height={16} logo />
      <span className={styles.name}>{name}</span>
      <IconChevronDown size={16} className={styles.icon} />
    </ModalTrigger>
  )
}

export default SelectChain
