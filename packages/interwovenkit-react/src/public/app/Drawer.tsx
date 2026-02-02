import clsx from "clsx"
import { Drawer as VaulDrawer } from "vaul"
import { type PropsWithChildren, useContext } from "react"
import type { FallbackProps } from "react-error-boundary"
import { useAtomValue } from "jotai"
import { useIsMutating, useQueryClient } from "@tanstack/react-query"
import AsyncBoundary from "@/components/AsyncBoundary"
import Button from "@/components/Button"
import Footer from "@/components/Footer"
import Scrollable from "@/components/Scrollable"
import Status from "@/components/Status"
import { LocalStorageKey } from "@/data/constants"
import { TX_APPROVAL_MUTATION_KEY, txRequestHandlerAtom } from "@/data/tx"
import { useDrawer } from "@/data/ui"
import { useIsMobile } from "@/hooks/useIsMobile"
import { useNavigate, usePath } from "@/lib/router"
import { pendingAutoSignRequestAtom } from "@/pages/autosign/data/store"
import { usePortalContainer } from "../portal"
import { PortalContext } from "./PortalContext"
import ScrollLock from "./ScrollLock"
import TxWatcher from "./TxWatcher"
import WidgetHeader from "./WidgetHeader"
import styles from "./Drawer.module.css"

const Drawer = ({ children }: PropsWithChildren) => {
  const { isDrawerOpen, closeDrawer } = useDrawer()
  const { setContainer } = useContext(PortalContext)
  const isMobile = useIsMobile()
  const portalContainer = usePortalContainer()

  const txRequest = useAtomValue(txRequestHandlerAtom)
  const pendingAutoSignRequest = useAtomValue(pendingAutoSignRequestAtom)
  const isPendingTransaction = useIsMutating({ mutationKey: [TX_APPROVAL_MUTATION_KEY] })
  const handleCloseDrawer = () => {
    const errorMessage = isPendingTransaction
      ? "User exited before response arrived. Transaction may succeed or fail."
      : "User rejected"
    closeDrawer()
    txRequest?.reject(new Error(errorMessage))
    pendingAutoSignRequest?.reject(new Error("User rejected"))
  }

  const path = usePath()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const errorBoundaryProps = {
    fallbackRender: ({ error, resetErrorBoundary }: FallbackProps) => {
      const retry = () => {
        if (path === "/bridge") {
          localStorage.removeItem(LocalStorageKey.BRIDGE_SRC_CHAIN_ID)
          localStorage.removeItem(LocalStorageKey.BRIDGE_SRC_DENOM)
          localStorage.removeItem(LocalStorageKey.BRIDGE_DST_CHAIN_ID)
          localStorage.removeItem(LocalStorageKey.BRIDGE_DST_DENOM)
        }

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

  return (
    <VaulDrawer.Root
      open={isDrawerOpen}
      onOpenChange={(open) => !open && handleCloseDrawer()}
      direction={isMobile ? "bottom" : "right"}
      modal={false}
    >
      <VaulDrawer.Portal container={portalContainer}>
        {isMobile && (
          <div
            className={styles.overlay}
            onClick={handleCloseDrawer}
            onKeyDown={(e) => e.key === "Escape" && handleCloseDrawer()}
            role="button"
            tabIndex={-1}
            aria-label="Close drawer"
          />
        )}
        <VaulDrawer.Content className={isMobile ? styles.mobileContent : styles.desktopContent}>
          <div className={clsx(styles.inner, "body")} ref={setContainer}>
            {isMobile && <ScrollLock />}
            <TxWatcher />
            <WidgetHeader />
            <AsyncBoundary errorBoundaryProps={errorBoundaryProps}>{children}</AsyncBoundary>
          </div>
        </VaulDrawer.Content>
      </VaulDrawer.Portal>
    </VaulDrawer.Root>
  )
}

export default Drawer
