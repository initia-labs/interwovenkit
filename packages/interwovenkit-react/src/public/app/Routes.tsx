import { useEffect } from "react"
import { useNavigate, usePath } from "@/lib/router"
import { useUpdateAmplitude } from "@/lib/amplitude/hooks"
import { useDrawer } from "@/data/ui"
import Connect from "@/pages/connect/Connect"
import Home from "@/pages/wallet/tabs/Home"
import Send from "@/pages/wallet/txs/send/Send"
import CollectionDetails from "@/pages/wallet/tabs/nft/CollectionDetails"
import NftDetails from "@/pages/wallet/tabs/nft/NftDetails"
import SendNft from "@/pages/wallet/txs/send-nft/SendNft"
import ManageChains from "@/pages/wallet/tabs/ManageChains"
import BridgeForm from "@/pages/bridge/BridgeForm"
import Withdrawals from "@/pages/bridge/op/Withdrawals"
import BridgePreview from "@/pages/bridge/BridgePreview"
import BridgeHistory from "@/pages/bridge/BridgeHistory"
import TxRequest from "@/pages/tx/TxRequest"
import { useAddress } from "../data/hooks"
import { useModal } from "./ModalContext"

const Routes = () => {
  const navigate = useNavigate()
  const path = usePath()
  const address = useAddress()
  const { closeDrawer } = useDrawer()
  const { closeModal } = useModal()

  useUpdateAmplitude()
  // whenever address changes, navigate to the appropriate path
  useEffect(() => {
    closeModal()

    if (path.startsWith("/bridge/")) {
      navigate("/bridge")
    }

    if (path === "/collection" || path.startsWith("/nft")) {
      navigate("/nfts")
    }

    // Run only on address changes, preventing navigation from triggering on path updates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address])

  if (path === "/connect") {
    if (address) return null
    return <Connect onSuccess={closeDrawer} />
  }

  if (path === "/blank") {
    return null
  }

  if (!address) {
    return <Connect />
  }

  switch (path) {
    case "/":
    case "/nfts":
    case "/activity":
      return <Home />
    case "/send":
      return <Send key={address} />
    case "/collection":
      return <CollectionDetails />
    case "/nft":
      return <NftDetails />
    case "/nft/send":
      return <SendNft key={address} />
    case "/rollups":
      return <ManageChains />
    case "/bridge":
      return <BridgeForm key={address} />
    case "/bridge/preview":
      return <BridgePreview />
    case "/bridge/history":
      return <BridgeHistory />
    case "/op/withdrawals":
      return <Withdrawals />
    case "/tx":
      return <TxRequest />
  }
}

export default Routes
