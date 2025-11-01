import { useEffect } from "react"
import { useAnalyticsTrack } from "@/data/analytics"
import { useDrawer } from "@/data/ui"
import { useNavigate, usePath } from "@/lib/router"
import EnableAutoSignPage from "@/pages/autosign/EnableAutoSignPage"
import BridgeForm from "@/pages/bridge/BridgeForm"
import BridgeHistory from "@/pages/bridge/BridgeHistory"
import BridgePreview from "@/pages/bridge/BridgePreview"
import Withdrawals from "@/pages/bridge/op/Withdrawals"
import Connect from "@/pages/connect/Connect"
import AddressQrPage from "@/pages/receive/AddressQrPage"
import RevokeGrantsPage from "@/pages/settings/autosign/RevokeGrantsPage"
import SettingsPage from "@/pages/settings/SettingsPage"
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

    if (path.startsWith("/bridge/")) {
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
    case "/receive":
      return <AddressQrPage />
    case "/settings":
      return <SettingsPage />
    case "/settings/revoke":
      return <RevokeGrantsPage />
    case "/autosign/enable":
      return <EnableAutoSignPage />
  }
}

export default Routes
