import styles from "./Version.module.css"

const Version = () => {
  return <aside className={styles.version}>v{__INTERWOVENKIT_VERSION__}</aside>
}

export default Version
