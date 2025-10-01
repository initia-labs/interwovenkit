import ky from "ky"

interface Grant {
  granter: string
  authorization: { msg: string }
  expiration?: string
}

interface GrantsResponse {
  grants: Grant[]
}

interface FeegrantResponse {
  allowance: {
    allowance?: {
      expiration?: string
    }
  }
}

export async function checkGhostWalletEnabled(
  granter: string,
  grantee: string,
  permissions: string[],
  restUrl: string,
): Promise<{ enabled: boolean; expiresAt?: number }> {
  if (!grantee) return { enabled: false }
  if (!permissions?.length) return { enabled: false }

  const client = ky.create({ prefixUrl: restUrl })

  try {
    // Check feegrant allowance
    const feegrantResponse = await client
      .get(`cosmos/feegrant/v1beta1/allowance/${granter}/${grantee}`)
      .json<FeegrantResponse>()

    // Check authz grants
    const grantsResponse = await client
      .get(`cosmos/authz/v1beta1/grants/grantee/${grantee}`)
      .json<GrantsResponse>()

    // Check that all required permissions have grants from the correct granter
    const relevantGrants = grantsResponse.grants.filter(
      (grant) => grant.granter === granter && permissions.includes(grant.authorization.msg),
    )

    const hasAllGrants = permissions.every((permission) =>
      relevantGrants.some((grant) => grant.authorization.msg === permission),
    )

    if (!hasAllGrants) {
      return { enabled: false }
    }

    // Find the earliest expiration from all grants and feegrant
    const expirations = [
      ...relevantGrants.map((grant) => grant.expiration).filter(Boolean),
      feegrantResponse.allowance?.allowance?.expiration,
    ]
      .filter(Boolean)
      .map((exp) => new Date(exp!).getTime())

    const earliestExpiration = expirations.length > 0 ? Math.min(...expirations) : undefined

    return {
      enabled: true,
      expiresAt: earliestExpiration,
    }
  } catch {
    return { enabled: false }
  }
}
