import type { BrowserProvider, JsonRpcSigner, TransactionReceipt, TransactionRequest } from "ethers"
import { ethers } from "ethers"
import { path } from "ramda"
import type { RouterChainJson } from "./chains"

const EVM_TX_CONFIRMATION_TIMEOUT_MS = 300000

function createTimeoutError(txHash: string) {
  const error = new Error("Transaction confirmation timed out") as Error & {
    code: string
    transactionHash: string
  }

  error.code = "TIMEOUT"
  error.transactionHash = txHash

  return error
}

function createCallException(receipt: TransactionReceipt) {
  const error = new Error("transaction execution reverted") as Error & {
    code: string
    receipt: TransactionReceipt
  }

  error.code = "CALL_EXCEPTION"
  error.receipt = receipt

  return error
}

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

const erc20Interface = new ethers.Interface([
  "function approve(address spender, uint256 amount) external returns (bool)",
])

export function createErc20ApproveTx({
  tokenContract,
  spender,
  amount,
}: {
  tokenContract: string
  spender: string
  amount: string
}): TransactionRequest {
  return {
    to: tokenContract,
    data: erc20Interface.encodeFunctionData("approve", [spender, amount]),
  }
}

export async function sendUncheckedEvmTransaction(
  signer: Pick<JsonRpcSigner, "sendUncheckedTransaction">,
  provider: Pick<BrowserProvider, "getBlockNumber" | "getTransaction" | "waitForTransaction">,
  tx: TransactionRequest,
) {
  const startBlock = await provider.getBlockNumber()
  const txHash = await signer.sendUncheckedTransaction(tx)

  const wait = (async () => {
    const transaction = await provider.getTransaction(txHash)
    const receipt = transaction
      ? await transaction.replaceableTransaction(startBlock).wait(1, EVM_TX_CONFIRMATION_TIMEOUT_MS)
      : await provider.waitForTransaction(txHash, 1, EVM_TX_CONFIRMATION_TIMEOUT_MS)

    if (!receipt) {
      throw createTimeoutError(txHash)
    }

    if (receipt.status === 0) {
      throw createCallException(receipt)
    }

    return receipt
  })()

  return { txHash, wait }
}
