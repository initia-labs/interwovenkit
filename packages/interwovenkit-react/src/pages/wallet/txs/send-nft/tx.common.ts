import ky from "ky"

// IBC를 통해 전송된 NFT의 routing path와 원본 class ID를 조회
export async function fetchIbcClassTrace(ibcClassName: string, restUrl: string) {
  const hash = ibcClassName.replace("ibc/", "")

  const { class_trace } = await ky
    .create({ prefixUrl: restUrl })
    .get(`ibc/apps/nft_transfer/v1/class_traces/${hash}`)
    .json<{ class_trace: { path: string; base_class_id: string } }>()

  return class_trace
}
