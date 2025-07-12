import clsx from "clsx"
import { useContext, useLayoutEffect, type PropsWithChildren } from "react"
import { createPortal } from "react-dom"
import { useMedia } from "react-use"
import type { FallbackProps } from "react-error-boundary"
import { useTransition, animated } from "@react-spring/web"
import { useQueryClient } from "@tanstack/react-query"
import { useNavigate } from "@/lib/router"
import { useDrawer } from "@/data/ui"
import AsyncBoundary from "@/components/AsyncBoundary"
import Scrollable from "@/components/Scrollable"
import Status from "@/components/Status"
import Footer from "@/components/Footer"
import Button from "@/components/Button"
import { usePortalContainer } from "../portal"
import { PortalContext } from "./PortalContext"
import WidgetHeader from "./WidgetHeader"
import TxWatcher from "./TxWatcher"
import styles from "./Drawer.module.css"

const Drawer = ({ children }: PropsWithChildren) => {
  const { isDrawerOpen, closeDrawer } = useDrawer()
  const { setContainer } = useContext(PortalContext)
  const isSmall = useMedia("(max-width: 576px)")

  // Lock body scroll when the drawer is open on small screens
  useLockBodyScroll(isDrawerOpen && isSmall)

  // Error
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const errorBoundaryProps = {
    fallbackRender: ({ error, resetErrorBoundary }: FallbackProps) => {
      const retry = () => {
        navigate("/")
        queryClient.clear()
        resetErrorBoundary()
      }

      return (
        <Scrollable>
          <Status error>{error.message}</Status>
          <Footer>
            <Button.White onClick={retry}>Retry</Button.White>
          </Footer>
        </Scrollable>
      )
    },
  }

  // Animation
  const drawerTransition = useTransition(isDrawerOpen, {
    from: { transform: isSmall ? "translateY(100%)" : "translateX(100%)" },
    enter: { transform: isSmall ? "translateY(0%)" : "translateX(0%)" },
    leave: { transform: isSmall ? "translateY(100%)" : "translateX(100%)" },
    config: { tension: 500, friction: 35, clamp: true },
  })

  return createPortal(
    <>
      {drawerTransition((style, item) =>
        item ? (
          <animated.button style={style} className={styles.overlay} onClick={closeDrawer}>
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="14" height="14">
              <path d="M7.168 14.04 l 6.028 -6.028 l -6.028 -6.028 L8.57 .582 L16 8.012 l -7.43 7.43 l -1.402 -1.402 Z" />
              <path d="M0.028 14.04 l 6.028 -6.028 L0.028 1.984 L1.43 .582 l 7.43 7.43 l -7.43 7.43 L0.028 14.04 Z" />
            </svg>
          </animated.button>
        ) : null,
      )}

      {drawerTransition((style, item) =>
        item ? (
          <animated.div style={style} className={clsx(styles.content, "body")}>
            <div ref={setContainer}>
              <TxWatcher />
              <WidgetHeader />
              <AsyncBoundary errorBoundaryProps={errorBoundaryProps}>{children}</AsyncBoundary>
            </div>
          </animated.div>
        ) : null,
      )}
    </>,
    usePortalContainer(),
  )
}

export default Drawer

function useLockBodyScroll(lock: boolean) {
  useLayoutEffect(() => {
    const originalOverflow = document.body.style.overflow
    if (lock) {
      document.body.style.overflow = "hidden" // disable scroll
    } else {
      document.body.style.overflow = originalOverflow // reset
    }
    return () => {
      document.body.style.overflow = originalOverflow
    }
  }, [lock])
}
