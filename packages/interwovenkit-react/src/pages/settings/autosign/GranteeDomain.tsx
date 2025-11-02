import styles from "./RevokeGrants.module.css"

interface GranteeDomainProps {
  domainName?: string
  domainIcon?: string
}

const GranteeDomain = ({ domainName, domainIcon }: GranteeDomainProps) => {
  if (!domainName) {
    return null
  }

  const { hostname } = new URL(domainName)

  return (
    <div className={styles.domainHeader}>
      {domainIcon && <img src={domainIcon} alt={domainName} className={styles.domainIcon} />}
      <span className={styles.domainName}>{hostname}</span>
    </div>
  )
}

export default GranteeDomain
