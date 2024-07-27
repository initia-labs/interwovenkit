import { useState, type ReactNode } from "react"

interface Props {
  value: string
  children: (params: { copy: () => void; copied: boolean }) => ReactNode
}

const CopyButton = ({ value, children }: Props) => {
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      setTimeout(() => setCopied(false), 1000)
    } catch {
      // ignore
    }
  }

  return children({ copy, copied })
}

export default CopyButton
