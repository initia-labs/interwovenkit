import type { Grant } from "@/pages/autosign/data/queries"
import { findEarliestDate } from "@/pages/autosign/data/validation"
import GrantItem from "./GrantItem"

interface GrantListProps {
  chainId: string
  grants: Grant[]
}

const GrantList = ({ chainId, grants }: GrantListProps) => {
  // Group grants by grantee using a map to avoid repeated object cloning.
  const groupedByGrantee = new Map<string, { grantee: string; expiration?: Date }>()

  for (const grant of grants) {
    const existing = groupedByGrantee.get(grant.grantee)
    const grantExpiration = grant.expiration ? new Date(grant.expiration) : undefined

    if (!existing) {
      groupedByGrantee.set(grant.grantee, { grantee: grant.grantee, expiration: grantExpiration })
      continue
    }

    existing.expiration = findEarliestDate([existing.expiration, grantExpiration])
  }

  const groupedGrants = [...groupedByGrantee.values()]

  return groupedGrants.map((grant) => (
    <GrantItem {...grant} chainId={chainId} key={grant.grantee} />
  ))
}

export default GrantList
