import { last } from "ramda"
import { BigNumber } from "bignumber.js"
import { toBase64, toHex } from "@cosmjs/encoding"
import type { BcsType, BcsTypeOptions } from "@mysten/bcs"
import { bcs as mystenBcs } from "@mysten/bcs"
import { AddressUtils } from "@/public/utils"

export function stringifyValue(content: unknown): string {
  switch (typeof content) {
    case "string":
      return content

    case "number":
    case "bigint":
      return content.toString()

    case "boolean":
      return content ? "true" : "false"

    case "object":
      if (content === null) return "null"
      if (content instanceof Uint8Array) return toBase64(content)
      if (Array.isArray(content)) return `[${content.map(stringifyValue).join(",")}]`
      return JSON.stringify(content, (_, value) =>
        typeof value === "bigint" ? value.toString() : value,
      )

    default:
      return "unknown"
  }
}

const bcs = {
  ...mystenBcs,
  address: addressSerializer,
  object: addressSerializer,
  bigdecimal: bigdecimalSerializer,
}

/** Recursively resolves a Move-style type string into a bcs.*() call */
export function resolveBcsType(typeStr: string): BcsType<unknown, unknown> {
  // Normalize the type string by removing 0x1:: prefix and converting to lowercase
  const normalizedType = typeStr
    .trim()
    .replace(/^0x1::/, "")
    .toLowerCase()

  // Handle object<T> or Object<T> - treat as just "object"
  if (normalizedType.startsWith("object<") || normalizedType.startsWith("object::object<")) {
    // @ts-expect-error // object serializer returns a different type
    return bcs.object()
  }

  // Try to match a generic like Foo<InnerType>
  const genericMatch = normalizedType.match(/^(\w+)<(.+)>$/)
  if (genericMatch) {
    const [, container, inner] = genericMatch
    // recurse for the inner type
    const innerBcs = resolveBcsType(inner)
    // invoke the container function on the result
    // @ts-expect-error // guaranteed to be a valid bcs.*() function
    return bcs[container](innerBcs)
  }

  // Try to match a generic in the last segment like option::option<InnerType>
  const segmentsForGeneric = normalizedType.split("::")
  const lastSegment = last(segmentsForGeneric)!
  const lastSegmentGenericMatch = lastSegment.match(/^(\w+)<(.+)>$/)
  if (lastSegmentGenericMatch) {
    const [, container, inner] = lastSegmentGenericMatch
    // recurse for the inner type
    const innerBcs = resolveBcsType(inner)
    // invoke the container function on the result
    // @ts-expect-error // guaranteed to be a valid bcs.*() function
    return bcs[container](innerBcs)
  }

  // Not a generic: split on "::" and take last segment, handle case variations
  const segments = normalizedType.split("::")
  const baseName = last(segments)!.toLowerCase()

  // call the corresponding bcs.*()
  // @ts-expect-error // guaranteed to be a valid bcs.*() function
  return bcs[baseName]()
}

function addressSerializer(options?: BcsTypeOptions<Uint8Array, Iterable<number>>) {
  return bcs.bytes(32, options).transform({
    input: (value: string) => AddressUtils.toBytes(value, 32),
    output: (value: Uint8Array) => `0x${toHex(value)}`,
  })
}

function bigdecimalSerializer(options?: BcsTypeOptions<string, string | number>) {
  return bcs.vector(bcs.u8(options)).transform({
    input: (value: string | number) => {
      const number = BigNumber(value).times(BigNumber(10).pow(18)).toFixed(0, BigNumber.ROUND_DOWN)
      return toLittleEndian(BigInt(number))
    },
    output: (val) => {
      const number = fromLittleEndian(new Uint8Array(val))
      return BigNumber(number).div(BigNumber(10).pow(18)).toFixed()
    },
  })
}

function toLittleEndian(value: bigint): Uint8Array {
  if (value < 0n) {
    throw new Error("negative values are not supported")
  }

  if (value === 0n) {
    return new Uint8Array([0])
  }

  const bytes: number[] = []
  let n = value
  while (n > 0n) {
    bytes.push(Number(n & 0xffn))
    n >>= 8n
  }
  return new Uint8Array(bytes)
}

function fromLittleEndian(bytes: Uint8Array): bigint {
  let result = 0n
  for (let i = 0; i < bytes.length; i++) {
    result += BigInt(bytes[i]) << BigInt(8 * i)
  }
  return result
}
