import { Suspense, useEffect } from "react"
import { animated, useTransition } from "@react-spring/web"
import { useNavigate, usePath, usePreviousPath } from "@/lib/router"
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
import Status from "@/components/Status"
import { useAddress } from "../data/hooks"
import { useModal } from "./ModalContext"

const routes = [
  { path: "/connect", Component: Connect },
  { path: "/", Component: Home },
  { path: "/send", Component: Send, rerender: true },
  { path: "/collection", Component: CollectionDetails },
  { path: "/nft", Component: NftDetails },
  { path: "/nft/send", Component: SendNft, rerender: true },
  { path: "/rollups", Component: ManageChains },
  { path: "/bridge", Component: BridgeForm, renderWithoutAddress: true, rerender: true },
  { path: "/bridge/preview", Component: BridgePreview },
  { path: "/bridge/history", Component: BridgeHistory, renderWithoutAddress: true },
  { path: "/op/withdrawals", Component: Withdrawals },
  { path: "/tx", Component: TxRequest },
]

const Routes = () => {
  const navigate = useNavigate()
  const address = useAddress()
  const { closeModal } = useModal()

  const parsePath = (path: string = "") => (["/nfts", "/activity"].includes(path) ? "/" : path)
  const path = parsePath(usePath())
  const prevPath = parsePath(usePreviousPath())

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

  // transitions
  const currentIndex = routes.findIndex((r) => r.path === path)
  const prevIndex = routes.findIndex((r) => r.path === prevPath)
  const direction = currentIndex >= prevIndex ? 1 : -1
  const transitions = useTransition(path, {
    from:
      direction > 0
        ? { opacity: 1, transform: `translateX(100%)` }
        : { opacity: 0, transform: `translateX(0%)` },
    enter: { opacity: 1, transform: "translateX(0%)" },
    leave:
      direction < 0
        ? { opacity: 1, transform: `translateX(100%)` }
        : { opacity: 0, transform: `translateX(0%)` },
    immediate: !prevPath,
  })

  // render routes
  if (path === "/connect") {
    if (address) return null
    return <Connect />
  }

  return (
    <div style={{ position: "relative", height: "100%", overflow: "hidden" }}>
      {transitions((style, animatedPath) => {
        const route = routes.find((r) => r.path === animatedPath)
        if (!route) return null
        if (!address && !route.renderWithoutAddress) return null

        const { Component, rerender } = route

        return (
          <animated.div
            key={animatedPath}
            style={{
              ...style,
              position: "absolute",
              width: "100%",
              height: "100%",
              backgroundColor: "var(--bg)",
            }}
          >
            <Suspense fallback={<Status>Loading...</Status>}>
              {rerender ? <Component key={address} /> : <Component />}
            </Suspense>
          </animated.div>
        )
      })}
    </div>
  )
}

export default Routes
