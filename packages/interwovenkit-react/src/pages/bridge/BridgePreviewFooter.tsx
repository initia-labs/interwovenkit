import type { StdFee } from "@cosmjs/stargate"
import type { TxJson } from "@skip-go/client"
import Button from "@/components/Button"
import Footer from "@/components/Footer"
import { type BridgeTxResult, useBridgeTx } from "./data/tx"

interface Props {
  tx: TxJson
  fee?: StdFee
  onCompleted?: (result: BridgeTxResult) => void
  confirmMessage?: string
  error?: string
}

const BridgePreviewFooter = ({ tx, fee, onCompleted, confirmMessage, error }: Props) => {
  const { mutate, isPending } = useBridgeTx(tx, { customFee: fee, onCompleted })
  return (
    <Footer>
      <Button.White
        onClick={() => mutate()}
        loading={isPending && "Signing transaction..."}
        disabled={!!error}
      >
        {error || confirmMessage || "Confirm"}
      </Button.White>
    </Footer>
  )
}

export default BridgePreviewFooter
