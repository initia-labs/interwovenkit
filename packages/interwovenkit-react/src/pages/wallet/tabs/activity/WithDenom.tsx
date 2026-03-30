import { metadataToDenom } from "@/data/assets"

import type { ReactNode } from "react"

interface Props {
  metadata: string
  children: (denom: string) => ReactNode
}

const WithDenom = ({ metadata, children }: Props) => {
  let denom: string

  try {
    denom = metadataToDenom(metadata)
  } catch {
    return null
  }

  return children(denom)
}

export default WithDenom
