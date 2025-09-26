import styles from "./Skeleton.module.css"

const Skeleton = ({ width = "100%", height }: { width?: string | number; height: number }) => {
  return <div className={styles.skeleton} style={{ width, height }} />
}

export default Skeleton
