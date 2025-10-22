import styles from "./RevokeGrantsItem.module.css"

interface GranteeDomainProps {
  domainName?: string
  domainIcon?: string
}

const GranteeDomain = ({ domainName, domainIcon }: GranteeDomainProps) => {
  if (!domainName) {
    return null
  }

  return (
    <div className={styles.domainHeader}>
      {domainIcon && <img src={domainIcon} alt={domainName} className={styles.domainIcon} />}
      <span className={styles.domainName}>{domainName}</span>
    </div>
  )
}

export default GranteeDomain
