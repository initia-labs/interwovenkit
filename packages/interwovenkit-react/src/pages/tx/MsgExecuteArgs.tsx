import ky from "ky"
import { useQuery } from "@tanstack/react-query"
import { ErrorBoundary } from "react-error-boundary"
import { useToggle } from "usehooks-ts"
import { createQueryKeys } from "@lukemorales/query-key-factory"
import { resolveBcsType } from "@initia/utils"
import { STALE_TIMES } from "@/data/http"
import { useChain } from "@/data/chains"
import Button from "@/components/Button"
import { stringifyValue } from "./stringify"
import styles from "./MsgExecuteArgs.module.css"

interface MoveContractAbi {
  exposed_functions: {
    name: string
    params: string[]
  }[]
}

const moveQueryKeys = createQueryKeys("interwovenkit:move", {
  abi: (restUrl: string, moduleAddress: string, moduleName: string, functionName: string) => {
    return [restUrl, moduleAddress, moduleName, functionName]
  },
})

interface MsgExecute {
  sender: string
  moduleAddress: string
  moduleName: string
  functionName: string
  typeArgs: string[]
  args: Uint8Array[]
}

interface Props {
  msg: MsgExecute
  chainId: string
  fallback: string
}

const DecodedArg = ({ type, arg }: { type: string; arg: Uint8Array }) => {
  return stringifyValue(resolveBcsType(type).parse(arg))
}

const MsgExecuteArgs = ({ msg, chainId, fallback }: Props) => {
  const [showDecoded, toggle] = useToggle(false)
  const { restUrl } = useChain(chainId)
  const { moduleAddress, moduleName, functionName, args } = msg

  const { data: abi } = useQuery({
    queryKey: moveQueryKeys.abi(restUrl, moduleAddress, moduleName, functionName).queryKey,
    queryFn: async () => {
      const data = await ky
        .create({ prefixUrl: restUrl })
        .get(`initia/move/v1/accounts/${moduleAddress}/modules/${moduleName}`)
        .json<{ module: { abi: string } }>()
      const abi = JSON.parse(data.module.abi) as MoveContractAbi
      const exposedFunction = abi.exposed_functions.find(({ name }) => name === functionName)
      if (!exposedFunction) {
        throw new Error(`Function ${functionName} not found in module ${moduleName}`)
      }
      return exposedFunction.params.filter((params) => !params.startsWith("&"))
    },
    staleTime: STALE_TIMES.INFINITY,
  })

  if (!abi) return fallback

  const renderDecodedArg = (arg: Uint8Array, index: number) => {
    const type = abi[index]

    return (
      <div className={styles.arg} key={index}>
        <div className={styles.type}>{type}</div>
        <ErrorBoundary fallback={<div className="error">Error decoding argument</div>}>
          <DecodedArg type={type} arg={arg} />
        </ErrorBoundary>
      </div>
    )
  }

  return (
    <div className={styles.container}>
      <Button.Small className={styles.toggle} onClick={toggle} disabled={!abi}>
        {showDecoded ? "Encode" : "Decode"}
      </Button.Small>

      {showDecoded ? <div className={styles.list}>{args.map(renderDecodedArg)}</div> : fallback}
    </div>
  )
}

export default MsgExecuteArgs
