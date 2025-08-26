import { bcs } from "@mysten/bcs"
import { toBase64 } from "@cosmjs/encoding"
import { createMoveClient, InitiaAddress } from "@initia/utils"

interface Params {
  restUrl: string
  moduleAddress: string
}

const moduleName = "usernames"

export function createUsernameClient({ restUrl, moduleAddress }: Params) {
  const { viewFunction } = createMoveClient(restUrl)

  async function getUsername(address: string) {
    if (!InitiaAddress.validate(address)) return null
    const name = await viewFunction<string>({
      moduleAddress,
      moduleName,
      functionName: "get_name_from_address",
      typeArgs: [],
      args: [toBase64(InitiaAddress(address, 32).bytes)],
    })
    if (!name) return null
    return name + ".init"
  }

  function validateUsername(username: string) {
    return /^[A-Za-z0-9-]{3,64}\.init$/.test(username)
  }

  async function getAddress(username: string) {
    if (!validateUsername(username)) return null
    const address = await viewFunction<string>({
      moduleAddress,
      moduleName,
      functionName: "get_address_from_name",
      typeArgs: [],
      args: [bcs.string().serialize(username.toLowerCase().replace(".init", "")).toBase64()],
    })
    if (!address) return null
    return InitiaAddress(address).bech32
  }

  return { restUrl, getUsername, getAddress, validateUsername }
}
