import { fromBech32 } from "@cosmjs/encoding"
import { useEffect, useEffectEvent, useState } from "react"
import { InitiaAddress } from "@initia/utils"
import Button from "@/components/Button"
import Footer from "@/components/Footer"
import { normalizeError } from "@/data/http"
import { useOfflineSigner } from "@/data/signer"
import { useInterwovenKit } from "@/public/data/hooks"
import { useFindChainType, useFindSkipChain } from "./data/chains"
import { useCosmosWallets } from "./data/cosmos"
import { deriveCosmosAddress, isEthKeyChain, isPubkeyRequired } from "./data/eth-key"
import { useBridgePreviewState } from "./data/tx"
import FooterWithError from "./FooterWithError"

import type { ReactNode } from "react"

interface Props {
  children: (addressList: string[]) => ReactNode
}

const FooterWithAddressList = ({ children }: Props) => {
  const state = useBridgePreviewState()
  const { route, values } = state
  const { required_chain_addresses } = route
  const { srcChainId, dstChainId, sender, recipient, cosmosWalletName } = values

  const { initiaAddress, hexAddress } = useInterwovenKit()
  const initiaSigner = useOfflineSigner()
  const { find: findCosmosWallet } = useCosmosWallets()

  const findSkipChain = useFindSkipChain()
  const findChainType = useFindChainType()

  // Intermediate Cosmos addresses are derived from the source account's key: the
  // connected Cosmos wallet for a Cosmos source, the Initia signer otherwise.
  const isCosmosSource = findChainType(findSkipChain(srcChainId)) === "cosmos"
  const sourceEthKey = isCosmosSource ? isEthKeyChain(srcChainId) : true
  const intermediateCosmosChainIds = required_chain_addresses
    .slice(0, -1)
    .filter((chainId) => findChainType(findSkipChain(chainId)) === "cosmos")
  const pubkeyRequired = isPubkeyRequired(intermediateCosmosChainIds, sourceEthKey)

  // Resolved inside the effect instead of memoized: the wallet list can be rebuilt every
  // render (default or inline `cosmosWallets`), and Keplr returns a new signer per call, so
  // a signer object as an effect dependency would refetch the public key on every render.
  const getSourceSigner = useEffectEvent(() => {
    if (!isCosmosSource) return initiaSigner
    const provider = findCosmosWallet(cosmosWalletName)?.getProvider()
    return provider?.getOfflineSignerOnlyAmino(srcChainId)
  })

  const [pubkey, setPubkey] = useState<Uint8Array | undefined>(undefined)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  useEffect(() => {
    let cancelled = false

    const fetchPubkey = async () => {
      try {
        setPubkey(undefined)
        setError(null)
        if (!pubkeyRequired) return
        const sourceSigner = getSourceSigner()
        if (!sourceSigner) throw new Error("Wallet not connected")
        setLoading(true)
        const [{ pubkey }] = await sourceSigner.getAccounts()
        if (cancelled) return
        setPubkey(pubkey)
      } catch (error) {
        const normalized = await normalizeError(error)
        if (cancelled) return
        setError(normalized)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    fetchPubkey()
    return () => {
      cancelled = true
    }
  }, [pubkeyRequired, isCosmosSource, cosmosWalletName, srcChainId, initiaSigner])

  if (error) {
    return <FooterWithError error={error} />
  }

  if (loading) {
    return (
      <Footer>
        <Button.White loading={loading && "Generating intermediary addresses..."} />
      </Footer>
    )
  }

  if (!pubkeyRequired || pubkey) {
    const addressList = required_chain_addresses.map((chainId, index) => {
      if (index === required_chain_addresses.length - 1) {
        const dstChain = findSkipChain(dstChainId)
        const findSkipChainType = findChainType(dstChain)
        if (findSkipChainType === "initia") return InitiaAddress(recipient).bech32
        return recipient
      }

      const chain = findSkipChain(chainId)
      switch (findChainType(chain)) {
        case "initia":
          return initiaAddress
        case "evm":
          return hexAddress
        case "cosmos":
          return deriveCosmosAddress(chain, {
            ethKey: sourceEthKey,
            address: fromBech32(isCosmosSource ? sender : initiaAddress).data,
            pubkey,
          })
        default:
          throw new Error("Unlisted chain type")
      }
    })

    return children(addressList)
  }

  return null
}

export default FooterWithAddressList
