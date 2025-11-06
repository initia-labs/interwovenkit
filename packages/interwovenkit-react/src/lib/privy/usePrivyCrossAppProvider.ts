// https://github.com/Abstract-Foundation/agw-sdk/blob/main/packages/agw-react/src/privy/usePrivyCrossAppProvider.ts

import type { CrossAppAccount, SignTypedDataParams, User } from "@privy-io/react-auth"
import {
  type Address,
  type Chain,
  createPublicClient,
  type EIP1193Provider,
  type EIP1193RequestFn,
  type EIP1474Methods,
  fromHex,
  http,
  type RpcSchema,
  toHex,
  type Transport,
} from "viem"
import { useConfig, useDisconnect } from "wagmi"
import { useCallback, useEffect, useMemo } from "react"
import { useConfig as useWidgetConfig } from "@/data/config"
import { PRIVY_APP_ID } from "@/public/data/connectors"

type RpcMethodNames<rpcSchema extends RpcSchema> = rpcSchema[keyof rpcSchema] extends {
  Method: string
}
  ? rpcSchema[keyof rpcSchema]["Method"]
  : never
type EIP1474MethodNames = RpcMethodNames<EIP1474Methods>

interface UsePrivyCrossAppEIP1193Props {
  chain: Chain
  transport?: Transport
}

export const usePrivyCrossAppProvider = ({
  chain,
  transport = http(undefined, { batch: true }),
}: UsePrivyCrossAppEIP1193Props) => {
  const { privyContext } = useWidgetConfig()
  const { disconnect } = useDisconnect()
  if (!privyContext) throw new Error("Privy context not found")
  const { privy, wallets, crossAppAccounts } = privyContext
  const { user, authenticated, ready: privyReady, login, logout } = privy
  const { sendTransaction, signMessage, signTypedData } = crossAppAccounts
  const config = useConfig()

  const wallet = wallets.find((wallet) => wallet.connectorType === "injected")

  const passthroughMethods = {
    web3_clientVersion: true,
    web3_sha3: true,
    net_listening: true,
    net_peerCount: true,
    net_version: true,
    eth_blobBaseFee: true,
    eth_blockNumber: true,
    eth_call: true,
    eth_chainId: true,
    eth_coinbase: true,
    eth_estimateGas: true,
    eth_feeHistory: true,
    eth_gasPrice: true,
    eth_getBalance: true,
    eth_getBlockByHash: true,
    eth_getBlockByNumber: true,
    eth_getBlockTransactionCountByHash: true,
    eth_getBlockTransactionCountByNumber: true,
    eth_getCode: true,
    eth_getFilterChanges: true,
    eth_getFilterLogs: true,
    eth_getLogs: true,
    eth_getProof: true,
    eth_getStorageAt: true,
    eth_getTransactionByBlockHashAndIndex: true,
    eth_getTransactionByBlockNumberAndIndex: true,
    eth_getTransactionByHash: true,
    eth_getTransactionCount: true,
    eth_getTransactionReceipt: true,
    eth_getUncleByBlockHashAndIndex: true,
    eth_getUncleByBlockNumberAndIndex: true,
    eth_getUncleCountByBlockHash: true,
    eth_getUncleCountByBlockNumber: true,
    eth_maxPriorityFeePerGas: true,
    eth_newBlockFilter: true,
    eth_newFilter: true,
    eth_newPendingTransactionFilter: true,
    eth_protocolVersion: true,
    eth_sendRawTransaction: true,
    eth_uninstallFilter: true,
  }
  const passthrough = (method: EIP1474MethodNames) => !!passthroughMethods[method]

  const publicClient = createPublicClient({
    chain,
    transport,
  })

  const getAddressesFromUser = useCallback(
    (user: User | null): { address: Address | undefined; isCrossApp: boolean } => {
      if (!user) {
        return { address: undefined, isCrossApp: false }
      }
      const crossAppAccount = user.linkedAccounts.find(
        (account) => account.type === "cross_app" && account.providerApp.id === PRIVY_APP_ID,
      ) as CrossAppAccount | undefined

      const crossAppAddress = crossAppAccount?.embeddedWallets?.[0]?.address
      const walletAddress = wallet?.address === user.wallet?.address ? wallet?.address : undefined

      return {
        address: (crossAppAddress || walletAddress) as Address | undefined,
        isCrossApp: !!crossAppAddress,
      }
    },
    [wallet?.address],
  )

  const getAccounts = useCallback(
    async (promptLogin: boolean) => {
      if (!privyReady || !authenticated) {
        return []
      }
      if (promptLogin) {
        await login()
      }
      const { address } = getAddressesFromUser(user)
      if (address) {
        return [address]
      } else {
        return []
      }
    },
    [privyReady, authenticated, getAddressesFromUser, user, login],
  )

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const eventListeners = new Map<string, ((...args: any[]) => void)[]>()

  const handleRequest = useCallback(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async (request: any) => {
      const { method, params } = request

      const { isCrossApp } = getAddressesFromUser(user)

      if (!isCrossApp) {
        if (method === "wallet_revokePermissions") {
          await logout()
          config._internal.connectors.setState([])
        }
        return (await wallet!.getEthereumProvider()).request(request)
      }

      if (passthrough(method as EIP1474MethodNames)) {
        return publicClient.request(request)
      }

      switch (method) {
        case "eth_requestAccounts": {
          return await getAccounts(true)
        }
        case "eth_accounts": {
          return await getAccounts(false)
        }
        case "wallet_switchEthereumChain":
          // TODO: do we need to do anything here?
          return null
        case "wallet_revokePermissions":
          await logout()
          config._internal.connectors.setState([])
          return
        case "eth_signTransaction":
          throw new Error("eth_signTransaction is not supported")
        case "eth_sendTransaction": {
          const transaction = params[0]
          // Undo the automatic formatting applied by Wagmi's eth_signTransaction
          // Formatter: https://github.com/wevm/viem/blob/main/src/zksync/formatters.ts#L114
          if (transaction.eip712Meta && transaction.eip712Meta.paymasterParams) {
            transaction.paymaster = transaction.eip712Meta.paymasterParams.paymaster
            transaction.paymasterInput = toHex(
              transaction.eip712Meta.paymasterParams.paymasterInput,
            )
          }
          return await sendTransaction(
            {
              ...transaction,
              chainId: chain.id,
            },
            {
              address: transaction.from,
            },
          )
        }
        case "eth_signTypedData_v4":
          return await signTypedData(JSON.parse(params[1]) as SignTypedDataParams, {
            address: params[0],
          })
        case "eth_sign":
          throw new Error("eth_sign is unsafe and not supported")
        case "personal_sign": {
          return await signMessage(fromHex(params[0], "string"), {
            address: params[1],
          })
        }
        default:
          throw new Error(`Unsupported request: ${method}`)
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [passthrough, publicClient, getAccounts, signMessage, user, wallet],
  )

  const provider: EIP1193Provider = useMemo(() => {
    return {
      on: (event, listener) => {
        eventListeners.set(event, [...(eventListeners.get(event) ?? []), listener])
      },
      removeListener: (event, listener) => {
        eventListeners.set(
          event,
          (eventListeners.get(event) ?? []).filter((l) => l !== listener),
        )
      },
      request: handleRequest as EIP1193RequestFn<EIP1474Methods>,
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handleRequest])

  // handle wallet changed
  useEffect(() => {
    const userAddress = user?.wallet?.address
    const walletAddress = wallet?.address
    const { isCrossApp } = getAddressesFromUser(user)

    const syncWalletAddress = async () => {
      if (!isCrossApp && userAddress && userAddress !== walletAddress) {
        disconnect()
        config._internal.connectors.setState([])
        await (
          await wallet!.getEthereumProvider()
        ).request({
          method: "wallet_revokePermissions",
          params: [
            {
              eth_accounts: {},
            },
          ],
        })
        await logout()
      }
    }

    syncWalletAddress()
    // we want to run this only when user or wallet changes to check for mismatch
  }, [user, wallet, getAddressesFromUser]) // eslint-disable-line react-hooks/exhaustive-deps

  const ready = useMemo(() => !!getAddressesFromUser(user).address, [getAddressesFromUser, user])

  return {
    ready,
    provider,
    meta: getAddressesFromUser(user).isCrossApp ? undefined : wallet?.meta,
  }
}
