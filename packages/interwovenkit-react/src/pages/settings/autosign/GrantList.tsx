import type { GrantInventoryItem } from "@/pages/autosign/data/inventory"
import GrantItem from "./GrantItem"

interface GrantListProps {
  inventory: GrantInventoryItem[]
}

const GrantList = ({ inventory }: GrantListProps) => {
  return inventory.map((grant) => (
    <GrantItem {...grant} key={`${grant.chainId}:${grant.grantee}`} />
  ))
}

export default GrantList
