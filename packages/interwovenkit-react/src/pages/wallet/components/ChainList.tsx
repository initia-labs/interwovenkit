import { useInitiaRegistry } from "@/data/chains"
import List from "@/components/List"

interface Props {
  onSelect: (chainId: string) => void
}

const ChainList = ({ onSelect }: Props) => {
  const chains = useInitiaRegistry()
  return (
    <List
      onSelect={(item) => onSelect(item.chainId)}
      list={chains}
      getImage={(item) => item.logoUrl}
      getName={(item) => item.name}
      getKey={(item) => item.chainId}
    />
  )
}

export default ChainList
