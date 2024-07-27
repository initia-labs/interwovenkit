import styles from "./Loader.module.css"

interface Props {
  size?: number
  color?: string
  border?: number
}

const Loader = ({ size = 24, color = "currentColor", border = 2 }: Props) => {
  const style = {
    width: `${size}px`,
    height: `${size}px`,
    borderColor: `${color} ${color} transparent ${color}`,
    borderWidth: `${border}px`,
  }

  return <div className={styles.loader} style={style} />
}

export default Loader
