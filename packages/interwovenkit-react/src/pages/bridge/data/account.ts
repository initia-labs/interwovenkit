import ky from "ky"

export async function waitForAccountCreation(address: string, restUrl: string) {
  const rest = ky.create({ prefixUrl: restUrl })
  const path = `cosmos/auth/v1beta1/account_info/${address}`

  for (let attempt = 1; attempt <= 24; attempt++) {
    try {
      return await rest.get(path).json()
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 5000))
    }
  }

  throw new Error(`Timeout: ${address} not found`)
}
