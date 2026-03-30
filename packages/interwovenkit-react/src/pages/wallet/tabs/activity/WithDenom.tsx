import { metadataToDenom } from "@/data/assets"

import type { ReactNode } from "react"

interface Props {
  metadata: string
  children: (denom: string) => ReactNode
}

const WithDenom = ({ metadata, children }: Props) => {
  return children(metadataToDenom(metadata))
}

export default WithDenom
