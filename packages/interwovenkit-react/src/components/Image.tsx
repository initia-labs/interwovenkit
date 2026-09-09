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

  // <span>, not <div>: the placeholder must be valid wherever an <img> is,
  // including phrasing contexts like <p> (a <div> there is invalid HTML).
  const unloader = placeholder ?? (
    <span
      className={clsx(styles.placeholder, classNames?.placeholder)}
      style={{ width, height, ...style }}
      aria-hidden="true"
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
      // Default to alt="" (decorative) so screen readers skip the image
      // instead of announcing the src filename.
      alt={alt ?? ""}
      loading="lazy"
      onError={() => setErrorSrc(src)}
    />
  )
}

export default Image
