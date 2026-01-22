import type { Grant } from "@/pages/autosign/data/queries"
import { findEarliestDate } from "@/pages/autosign/data/validation"
import GrantItem from "./GrantItem"

interface GrantListProps {
  chainId: string
  grants: Grant[]
}

const GrantList = ({ chainId, grants }: GrantListProps) => {
  // Group grants by grantee to find the earliest expiration across all their grants
  const groupedGrants = Object.values(
    grants.reduce(
      (acc, grant) => {
        const existing = acc[grant.grantee]
        if (existing) {
          return {
            ...acc,
            [grant.grantee]: {
              ...existing,
              expiration: findEarliestDate([
                existing.expiration,
                grant.expiration ? new Date(grant.expiration) : undefined,
              ]),
            },
          }
        }
        return {
          ...acc,
          [grant.grantee]: {
            grantee: grant.grantee,
            expiration: grant.expiration ? new Date(grant.expiration) : undefined,
          },
        }
      },
      {} as Record<string, { grantee: string; expiration?: Date }>,
    ),
  )

  return groupedGrants.map((grant) => (
    <GrantItem {...grant} chainId={chainId} key={grant.grantee} />
  ))
}

export default GrantList
