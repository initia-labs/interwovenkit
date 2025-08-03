import { toBase64 } from "@cosmjs/encoding"

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
