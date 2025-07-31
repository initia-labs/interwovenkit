import clsx from "clsx"
import type { ReactNode } from "react"
import { useContext, useEffect } from "react"
import { createPortal } from "react-dom"
import { useTransition, animated } from "@react-spring/web"
import { IconClose } from "@initia/icons-react"
import { usePortal } from "@/public/app/PortalContext"
import { fullscreenContext } from "@/public/app/fullscreen"
import styles from "./Modal.module.css"

interface Props {
  title?: string
  children: ReactNode
  trigger?: ReactNode
  className?: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

const Modal = ({ title, children, trigger, className, open, onOpenChange }: Props) => {
  const portal = usePortal()
  const fullscreen = useContext(fullscreenContext)

  useEffect(() => {
    if (!open) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onOpenChange(false)
      }
    }

    document.addEventListener("keydown", handleKeyDown)
    return () => {
      document.removeEventListener("keydown", handleKeyDown)
    }
  }, [onOpenChange, open])

  const overlayTransitions = useTransition(open, {
    from: { opacity: 0 },
    enter: { opacity: 1 },
    leave: { opacity: 0 },
    config: { tension: 500, friction: 30, clamp: true },
  })

  const contentTransitions = useTransition(open, {
    from: { opacity: 0, transform: "translateY(24px)" },
    enter: { opacity: 1, transform: "translateY(0px)" },
    leave: { opacity: 0, transform: "translateY(24px)" },
    config: { tension: 500, friction: 30, clamp: true },
  })

  if (!portal) return null

  return (
    <>
      {trigger && (
        <button type="button" className={className} onClick={() => onOpenChange(true)}>
          {trigger}
        </button>
      )}

      {createPortal(
        <>
          {overlayTransitions(
            (style, item) =>
              item && (
                <animated.div
                  style={style}
                  className={clsx(styles.overlay, { [styles.fullscreen]: fullscreen })}
                  onClick={() => onOpenChange(false)}
                  onKeyDown={() => onOpenChange(false)}
                  role="button"
                  tabIndex={0}
                />
              ),
          )}

          {contentTransitions(
            (style, item) =>
              item && (
                <animated.div
                  style={style}
                  className={clsx(styles.content, { [styles.fullscreen]: fullscreen })}
                >
                  {title && (
                    <header className={styles.header}>
                      <h2 className={styles.title}>{title}</h2>
                      <button
                        type="button"
                        className={styles.close}
                        onClick={() => onOpenChange(false)}
                      >
                        <IconClose size={20} />
                      </button>
                    </header>
                  )}

                  {children}
                </animated.div>
              ),
          )}
        </>,
        portal,
      )}
    </>
  )
}

export default Modal
