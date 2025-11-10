import ky from "ky"

// Fetch the routing path and original class ID of NFTs transferred via IBC
export async function fetchIbcClassTrace(ibcClassName: string, restUrl: string) {
  const hash = ibcClassName.replace("ibc/", "")

  const { class_trace } = await ky
    .create({ prefixUrl: restUrl })
    .get(`ibc/apps/nft_transfer/v1/class_traces/${hash}`)
    .json<{ class_trace: { path: string; base_class_id: string } }>()

  return class_trace
}
