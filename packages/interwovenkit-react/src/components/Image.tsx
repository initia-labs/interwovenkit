import clsx from "clsx"
import { useEffect, useState, type ImgHTMLAttributes, type ReactNode } from "react"
import { Img } from "react-image"
import styles from "./Image.module.css"

interface Props extends ImgHTMLAttributes<HTMLImageElement> {
  placeholder?: ReactNode
  classNames?: { placeholder?: string }
  circle?: boolean
}

const Image = ({ src, alt, placeholder, classNames, circle, ...attrs }: Props) => {
  const { width, height } = attrs
  const [isLoaded, setIsLoaded] = useState(false)
  const unloader = placeholder ?? (
    <div className={clsx(styles.placeholder, classNames?.placeholder)} style={{ width, height }} />
  )

  useEffect(() => {
    // When src changes to a new URL, reset isLoaded to show the placeholder
    setIsLoaded(false)

    // If src is undefined or null, reset the loaded state and do nothing else.
    if (!src) {
      return
    }

    // use isMounted to prevent state update after component unmounts
    let isMounted = true
    const image = new window.Image()
    image.src = src

    image.onload = () => {
      if (isMounted) {
        setIsLoaded(true)
      }
    }

    return () => {
      isMounted = false
    }
  }, [src])

  if (!src || !isLoaded) {
    return unloader
  }

  return (
    <Img
      {...attrs}
      className={clsx(attrs.className, { [styles.circle]: circle })}
      style={{ width, height }}
      src={src}
      alt={alt}
      unloader={unloader}
      loading="lazy"
    />
  )
}

export default Image
