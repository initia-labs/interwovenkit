import clsx from "clsx"
import { type PropsWithChildren, useContext } from "react"
import type { FallbackProps } from "react-error-boundary"
import { useAtomValue } from "jotai"
import { Dialog } from "@base-ui-components/react/dialog"
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
import { pendingAutoSignRequestAtom } from "@/pages/autosign/data/state"
import { usePortalContainer } from "../portal"
import { PortalContext } from "./PortalContext"
import ScrollLock from "./ScrollLock"
import TxWatcher from "./TxWatcher"
import WidgetHeader from "./WidgetHeader"
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
  const pendingAutoSignRequest = useAtomValue(pendingAutoSignRequestAtom)
  const isPendingTransaction = useIsMutating({ mutationKey: [TX_APPROVAL_MUTATION_KEY] })
  const handleCloseDrawer = () => {
    const errorMessage = isPendingTransaction
      ? "User exited before response arrived. Transaction may succeed or fail."
      : "User rejected"
    // The drawer must be closed first.
    // This is because `reject` may re-throw the error after handling it.
    closeDrawer()
    txRequest?.reject(new Error(errorMessage))
    pendingAutoSignRequest?.reject(new Error("User rejected"))
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
      // We intentionally use `modal={false}` instead of `modal="trap-focus"`
      // because the drawer must be closable via outside clicks.
      // In the current Base UI implementation, enabling "trap-focus" prevents
      // users from dismissing the drawer by clicking outside of it.
      // If Base UI is updated in the future to support outside-click dismissal
      // while "trap-focus" is active, consider switching back to "trap-focus"
      // for improved accessibility and focus management.
      modal={false}
    >
      <Dialog.Portal container={portalContainer}>
        {isSmall && (
          // This onClick is required for the close functionality to work in production builds.
          // Without it, closing only works in local dev. Don't remove until thoroughly tested.
          <Dialog.Backdrop className={styles.overlay} onClick={handleCloseDrawer}>
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="14" height="14">
              <path d="M7.168 14.04 l 6.028 -6.028 l -6.028 -6.028 L8.57 .582 L16 8.012 l -7.43 7.43 l -1.402 -1.402 Z" />
              <path d="M0.028 14.04 l 6.028 -6.028 L0.028 1.984 L1.43 .582 l 7.43 7.43 l -7.43 7.43 L0.028 14.04 Z" />
            </svg>
          </Dialog.Backdrop>
        )}

        <Dialog.Popup className={styles.content}>
          <div className={clsx(styles.inner, "body")} ref={setContainer}>
            {isSmall && <ScrollLock />}
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
