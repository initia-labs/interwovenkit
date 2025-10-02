import { useEffect } from "react"
import { useNavigate, usePath } from "@/lib/router"
import { useAnalyticsTrack } from "@/data/analytics"
import { useDrawer } from "@/data/ui"
import Connect from "@/pages/connect/Connect"
import Home from "@/pages/wallet/tabs/Home"
import Send from "@/pages/wallet/txs/send/Send"
import NftDetails from "@/pages/wallet/tabs/nft/NftDetails"
import SendNft from "@/pages/wallet/txs/send-nft/SendNft"
import BridgeForm from "@/pages/bridge/BridgeForm"
import Withdrawals from "@/pages/bridge/op/Withdrawals"
import BridgePreview from "@/pages/bridge/BridgePreview"
import BridgeHistory from "@/pages/bridge/BridgeHistory"
import TxRequest from "@/pages/tx/TxRequest"
import GhostWallet from "@/pages/ghost-wallet/GhostWallet"
import AddressQrPage from "@/pages/wallet/receive/AddressQrPage"
import RevokeGrantsPage from "@/pages/revoke-grants/RevokeGrantsPage"
import SettingsPage from "@/pages/settings/SettingsPage"
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
    case "/ghost-wallet":
      return <GhostWallet />
  }
}

export default Routes
