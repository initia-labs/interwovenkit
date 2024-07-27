import { path } from "ramda"
import type { BrowserProvider } from "ethers"
import type { RouterChainJson } from "./chains"

export async function switchEthereumChain(provider: BrowserProvider, chain: RouterChainJson) {
  const { chain_type, chain_id, chain_name, evm_fee_asset, rpc } = chain

  if (chain_type !== "evm") {
    throw new Error(`Chain is not an EVM chain: ${chain_name}`)
  }

  try {
    await provider.send("wallet_switchEthereumChain", [
      { chainId: `0x${Number(chain_id).toString(16)}` },
    ])
  } catch (error) {
    if (path(["error", "code"], error) !== 4902) {
      throw error
    }

    if (!evm_fee_asset) {
      throw new Error(`Fee asset is not defined for chain: ${chain_name}`)
    }

    await provider.send("wallet_addEthereumChain", [
      {
        chainId: `0x${Number(chain_id).toString(16)}`,
        chainName: chain_name,
        nativeCurrency: evm_fee_asset,
        rpcUrls: [rpc],
      },
    ])

    await provider.send("wallet_switchEthereumChain", [
      { chainId: `0x${Number(chain_id).toString(16)}` },
    ])
  }
}
