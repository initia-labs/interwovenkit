import clsx from "clsx"
import type { ButtonHTMLAttributes } from "react"
import Loader from "./Loader"
import styles from "./Button.module.css"

export interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  sm?: boolean
  fullWidth?: boolean
  loading?: boolean | string
}

const WhiteButton = (props: Props) => {
  const { sm, fullWidth, loading, className, children, disabled, ...attrs } = props
  return (
    <button
      {...attrs}
      className={clsx(styles.button, { [styles.sm]: sm, [styles.full]: fullWidth }, className)}
      disabled={!!loading || disabled}
    >
      {loading ? (
        <>
          <Loader color="currentColor" size={16} />
          {typeof loading === "string" && <span className={styles.loading}>{loading}</span>}
        </>
      ) : (
        children
      )}
    </button>
  )
}

const OutlineButton = ({ className, ...props }: Props) => {
  return <WhiteButton {...props} className={clsx(styles.outline, className)} />
}

interface SmallButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  unpadded?: boolean
}

const SmallButton = ({ className, unpadded, ...attrs }: SmallButtonProps) => {
  return (
    <button {...attrs} className={clsx(styles.small, { [styles.unpadded]: unpadded }, className)} />
  )
}

const Button = {
  White: WhiteButton,
  Outline: OutlineButton,
  Small: SmallButton,
}

export default Button
