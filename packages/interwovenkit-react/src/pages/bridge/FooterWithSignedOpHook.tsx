import Button from "@/components/Button"
import Footer from "@/components/Footer"
import FormHelp from "@/components/form/FormHelp"
import type { SignedOpHook } from "./data/tx"
import { useBridgePreviewState, useSignOpHook } from "./data/tx"

import type { ReactNode } from "react"

const FooterWithSignedOpHook = ({ children }: { children: (data?: SignedOpHook) => ReactNode }) => {
  const { route } = useBridgePreviewState()

  const signOpHook = useSignOpHook()

  if (route.required_op_hook && !signOpHook.data) {
    return (
      <Footer extra={<FormHelp level="error">{signOpHook.error?.message}</FormHelp>}>
        <Button.White
          onClick={() => signOpHook.mutate()}
          loading={signOpHook.isPending && "Awaiting signature..."}
        >
          Authorize conversion
        </Button.White>
      </Footer>
    )
  }

  return children(signOpHook.data)
}

export default FooterWithSignedOpHook
