import type { ButtonHTMLAttributes, MouseEvent } from "react"
import { useNavigate } from "./RouterContext"
import Amplitude from "../amplitude"

export interface LinkProp extends ButtonHTMLAttributes<HTMLButtonElement> {
  to: string | number
  state?: object
  ["data-amp-track-name"]?: string
}

const Link = ({
  to,
  state,
  children,
  onClick,
  ["data-amp-track-name"]: amplitudeEventName,
  ...attrs
}: LinkProp) => {
  const navigate = useNavigate()

  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault()
    if (amplitudeEventName) {
      const eventData = Object.fromEntries(
        Object.entries(attrs)
          .filter(([key]) => key.startsWith("data-amp-track-"))
          .map(([key, value]) => [key.replace("data-amp-track-", ""), value]),
      )
      Amplitude.logEvent(amplitudeEventName, { ...eventData, type: "click" })
    }
    onClick?.(event)
    navigate(to, state)
  }

  return (
    <button type="button" {...attrs} onClick={handleClick}>
      {children}
    </button>
  )
}

export default Link
