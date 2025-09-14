import clsx from "clsx"
import { useAtomValue } from "jotai"
import { useContext, type PropsWithChildren } from "react"
import type { FallbackProps } from "react-error-boundary"
import { Dialog } from "@base-ui-components/react/dialog"
import { useIsMutating, useQueryClient } from "@tanstack/react-query"
import { useNavigate, usePath } from "@/lib/router"
import { LocalStorageKey } from "@/data/constants"
import { useDrawer } from "@/data/ui"
import { TX_APPROVAL_MUTATION_KEY, txRequestHandlerAtom } from "@/data/tx"
import { useIsMobile } from "@/hooks/useIsMobile"
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
  const isSmall = useIsMobile()
  const portalContainer = usePortalContainer()

  // FIXME: React StrictMode causes a problem by unmounting the component once on purpose.
  // Should reject on unmount, but didn't work as expected.
  // Currently handled via drawer/modal close instead.
  // Would be nice to fix this properly later.
  const txRequest = useAtomValue(txRequestHandlerAtom)
  const isPendingTransaction = useIsMutating({ mutationKey: [TX_APPROVAL_MUTATION_KEY] })
  const handleCloseDrawer = () => {
    const errorMessage = isPendingTransaction
      ? "User exited before response arrived. Transaction may succeed or fail."
      : "User rejected"
    // The drawer must be closed first.
    // This is because `reject` may re-throw the error after handling it.
    closeDrawer()
    txRequest?.reject(new Error(errorMessage))
  }

  // Error
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
    <Dialog.Root
      open={isDrawerOpen}
      onOpenChange={(open) => !open && handleCloseDrawer()}
      modal={isSmall}
    >
      <Dialog.Portal container={portalContainer}>
        <Dialog.Popup className={styles.content}>
          <div className={clsx(styles.inner, "body")} ref={setContainer}>
            <TxWatcher />
            <WidgetHeader />
            <AsyncBoundary errorBoundaryProps={errorBoundaryProps}>{children}</AsyncBoundary>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

export default Drawer
