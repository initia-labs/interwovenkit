import type { ButtonHTMLAttributes, MouseEvent } from "react"
import { useNavigate, useReset } from "./RouterContext"

export interface LinkProp extends ButtonHTMLAttributes<HTMLButtonElement> {
  to: string | number
  state?: object
  shouldReset?: boolean
}

const Link = ({ to, state, shouldReset, children, onClick, ...attrs }: LinkProp) => {
  const navigate = useNavigate()
  const reset = useReset()

  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault()
    onClick?.(event)
    if (shouldReset) {
      reset(to as string, state)
    } else {
      navigate(to, state)
    }
  }

  return (
    <button type="button" {...attrs} onClick={handleClick}>
      {children}
    </button>
  )
}

export default Link
