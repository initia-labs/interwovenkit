import type { EncodeObject } from "@cosmjs/proto-signing"

export function decodeCosmosAminoMessages(
  msgs: Array<{ msg_type_url?: string; msg?: string }> | undefined,
  options: {
    fromAmino: (value: { type: string; value: unknown }) => EncodeObject
    converters: Record<string, { aminoType: string }>
  },
): EncodeObject[] {
  if (!msgs?.length) throw new Error("Invalid transaction data")

  return msgs.map(({ msg_type_url, msg }) => {
    if (!(msg_type_url && msg)) throw new Error("Invalid transaction data")

    const converter = options.converters[msg_type_url]
    if (!converter) throw new Error(`Unsupported message type: ${msg_type_url}`)

    return options.fromAmino({
      type: converter.aminoType,
      value: JSON.parse(msg),
    })
  })
}
