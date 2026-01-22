import Skeleton from "./Skeleton"
import styles from "./Skeletons.module.css"

interface SkeletonsProps {
  height: number
  length?: number
  width?: number | string
}

const Skeletons = ({ height, length = 1, width = "100%" }: SkeletonsProps) => {
  const items = Array.from({ length }, (_, i) => i)

  if (length === 1) {
    return <Skeleton height={height} width={width} />
  }

  return (
    <div className={styles.container}>
      {items.map((i) => (
        <Skeleton key={i} height={height} width={width} />
      ))}
    </div>
  )
}

export default Skeletons
