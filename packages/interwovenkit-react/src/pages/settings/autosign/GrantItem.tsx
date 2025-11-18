import Image from "@/components/Image"
import { useChain } from "@/data/chains"
import { useDisableAutoSign } from "@/pages/autosign/data/actions"
import ExpirationCountdown from "./ExpirationCountdown"
import styles from "./GrantItem.module.css"

interface GrantItemProps {
  chainId: string
  grantee: string
  messageTypes: string[]
  expiration?: Date
}

const GrantItem = ({ chainId, grantee, messageTypes, expiration }: GrantItemProps) => {
  const chain = useChain(chainId)

  const { mutate, isPending } = useDisableAutoSign({
    grantee,
    messageTypes: { [chainId]: messageTypes },
    internal: true,
  })

  return (
    <div className={styles.container}>
      <div className={styles.info}>
        <div className={styles.header}>
          <Image src={chain.logoUrl} width={16} height={16} logo />
          <div className={styles.chainName}>{chain.name}</div>
        </div>
        <div className={styles.expiration}>
          {!expiration ? "Until revoked" : <ExpirationCountdown expiration={expiration} />}
        </div>
      </div>
      <button className={styles.revokeButton} onClick={() => mutate(chainId)} disabled={isPending}>
        {isPending ? "Revoking..." : "Revoke"}
      </button>
    </div>
  )
}

export default GrantItem
