import clsx from "clsx"
import type { ImgHTMLAttributes, ReactNode } from "react"
import { useState, useEffect } from "react"
import styles from "./Image.module.css"

interface Props extends ImgHTMLAttributes<HTMLImageElement> {
  placeholder?: ReactNode
  classNames?: { placeholder?: string }
  logo?: boolean
}

const Image = ({ src, alt, placeholder, classNames, style, logo, ...attrs }: Props) => {
  const [hasError, setHasError] = useState(false)
  const { width, height } = attrs

  const unloader = placeholder ?? (
    <div
      className={clsx(styles.placeholder, classNames?.placeholder)}
      style={{ width, height, ...style }}
    />
  )

  // Reset state when src changes
  useEffect(() => {
    setHasError(false)
  }, [src])

  if (!src || hasError) {
    return unloader
  }

  return (
    <img
      {...attrs}
      className={clsx(attrs.className, { [styles.logo]: logo })}
      style={{ width, height, ...style }}
      src={src}
      alt={alt}
      loading="lazy"
      onError={() => setHasError(true)}
    />
  )
}

export default Image
