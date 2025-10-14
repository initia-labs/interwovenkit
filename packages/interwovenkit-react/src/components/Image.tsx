import clsx from "clsx"
import { useState } from "react"
import styles from "./Image.module.css"

import type { ImgHTMLAttributes, ReactNode } from "react"

interface Props extends ImgHTMLAttributes<HTMLImageElement> {
  placeholder?: ReactNode
  classNames?: { placeholder?: string }
  logo?: boolean
}

const Image = ({ src, alt, placeholder, classNames, style, logo, ...attrs }: Props) => {
  const [errorSrc, setErrorSrc] = useState<string | undefined>(undefined)
  const { width, height } = attrs

  const unloader = placeholder ?? (
    <div
      className={clsx(styles.placeholder, classNames?.placeholder)}
      style={{ width, height, ...style }}
    />
  )

  const hasError = errorSrc === src

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
      onError={() => setErrorSrc(src)}
    />
  )
}

export default Image
