import { useEffect } from "react"
import { useAnalyticsTrack } from "@/data/analytics"
import { useDrawer } from "@/data/ui"
import { useNavigate, usePath } from "@/lib/router"
import EnableAutoSign from "@/pages/autosign/EnableAutoSign"
import BridgeForm from "@/pages/bridge/BridgeForm"
import BridgeHistory from "@/pages/bridge/BridgeHistory"
import BridgePreview from "@/pages/bridge/BridgePreview"
import Withdrawals from "@/pages/bridge/op/Withdrawals"
import Connect from "@/pages/connect/Connect"
import Deposit from "@/pages/deposit/Deposit"
import { TransferCompleted } from "@/pages/deposit/TransferCompleted"
import Withdraw from "@/pages/deposit/Withdraw"
import Receive from "@/pages/receive/Receive"
import ManageAutoSign from "@/pages/settings/autosign/ManageAutoSign"
import Settings from "@/pages/settings/Settings"
import TxRequest from "@/pages/tx/TxRequest"
import Home from "@/pages/wallet/tabs/Home"
import NftDetails from "@/pages/wallet/tabs/nft/NftDetails"
import Send from "@/pages/wallet/txs/send/Send"
import SendNft from "@/pages/wallet/txs/send-nft/SendNft"
import { useAddress } from "../data/hooks"
import { useModal } from "./ModalContext"

const Routes = () => {
  const navigate = useNavigate()
  const path = usePath()
  const address = useAddress()
  const { closeDrawer } = useDrawer()
  const { closeModal } = useModal()

  // whenever address changes, navigate to the appropriate path
  useEffect(() => {
    closeModal()

    if (path.startsWith("/bridge/") && path !== "/bridge/history") {
      navigate("/bridge")
    }

    if (path === "/collection" || path.startsWith("/nft")) {
      navigate("/nfts")
    }

    // Run only on address changes, preventing navigation from triggering on path updates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address])

  // Track page views when path changes
  const track = useAnalyticsTrack()
  useEffect(() => {
    track("Page View")
  }, [path, track])

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
    case "/receive":
      return <Receive />
    case "/nft":
      return <NftDetails />
    case "/nft/send":
      return <SendNft key={address} />
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
    case "/autosign/enable":
      return <EnableAutoSign />
    case "/settings":
      return <Settings />
    case "/settings/autosign":
      return <ManageAutoSign />
    case "/deposit":
      return <Deposit />
    case "/deposit/completed":
      return <TransferCompleted type="deposit" />
    case "/withdraw":
      return <Withdraw />
    case "/withdraw/completed":
      return <TransferCompleted type="withdraw" />
  }
}

export default Routes
