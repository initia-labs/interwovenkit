import Skeleton from "./Skeleton"
import styles from "./FallBack.module.css"

interface FallBackProps {
  height: number | string
  length?: number
  width?: number | string
}

const FallBack = ({ height, length = 1, width = "100%" }: FallBackProps) => {
  const items = Array.from({ length }, (_, i) => i)

  if (length === 1) {
    return <Skeleton height={typeof height === "number" ? height : 0} width={width} />
  }

  return (
    <div className={styles.container}>
      {items.map((i) => (
        <Skeleton key={i} height={typeof height === "number" ? height : 0} width={width} />
      ))}
    </div>
  )
}

export default FallBack
