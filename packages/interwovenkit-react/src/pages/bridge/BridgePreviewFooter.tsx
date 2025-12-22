import type { StdFee } from "@cosmjs/stargate"
import type { TxJson } from "@skip-go/client"
import Button from "@/components/Button"
import Footer from "@/components/Footer"
import { useBridgeTx } from "./data/tx"

interface Props {
  tx: TxJson
  fee?: StdFee
  navigateTo?: string
  confirmMessage?: string
}

const BridgePreviewFooter = ({ tx, fee, navigateTo, confirmMessage }: Props) => {
  const { mutate, isPending } = useBridgeTx(tx, { customFee: fee, navigateTo })
  return (
    <Footer>
      <Button.White onClick={() => mutate()} loading={isPending && "Signing transaction..."}>
        {confirmMessage || "Confirm"}
      </Button.White>
    </Footer>
  )
}

export default BridgePreviewFooter
