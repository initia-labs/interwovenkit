import { getAddress, isAddress } from "ethers"
import { fromBech32, fromHex, toBech32, toHex } from "@cosmjs/encoding"

export const AddressUtils = {
  toBytes(address: string, byteLength: number = 20) {
    if (!address) throw new Error("address is required")

    if (address.match(/^(0x)?[0-9a-fA-F]+$/)) {
      const hex = address.replace(/^0x/, "").padStart(byteLength * 2, "0")
      return fromHex(hex)
    }

    const { data } = fromBech32(address)
    if (data.length >= byteLength) return data
    return new Uint8Array([...Array(byteLength - data.length).fill(0), ...data])
  },

  toBech32(address: string, prefix: string = "init") {
    if (!address) return ""
    return toBech32(prefix, AddressUtils.toBytes(address))
  },

  toHex(address: string) {
    if (!address) return ""
    return toHex(AddressUtils.toBytes(address))
  },

  toPrefixedHex(address: string) {
    if (!address) return ""
    const checksummed = getAddress(AddressUtils.toHex(address))
    const bytes = AddressUtils.toBytes(address)
    const last = bytes[bytes.length - 1]
    const isSpecial = bytes.subarray(0, bytes.length - 1).every((byte) => byte === 0) && last < 0x10
    if (isSpecial) return checksummed.replace(/^0x0+/, "0x")
    return checksummed
  },

  validate(address: string, prefix: string = "init") {
    if (isAddress(address)) {
      return true
    }

    try {
      return fromBech32(address).prefix === prefix
    } catch {
      return false
    }
  },

  equals(address1: string, address2: string) {
    return AddressUtils.toBech32(address1) === AddressUtils.toBech32(address2)
  },
}
