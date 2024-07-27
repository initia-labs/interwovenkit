import Scrollable from "./Scrollable"
import Image from "./Image"
import Loader from "./Loader"
import styles from "./List.module.css"

interface Props<Item> {
  onSelect: (item: Item) => void
  list: Item[]
  getImage: (item: Item) => string
  getName: (item: Item) => string
  getKey: (item: Item) => string
  getIsLoading?: (item: Item) => boolean
  getDisabled?: (item: Item) => boolean
}

function List<Item>({ onSelect, list, ...props }: Props<Item>) {
  const { getImage, getName, getKey, getIsLoading, getDisabled } = props
  return (
    <Scrollable className={styles.scrollable}>
      <div className={styles.list}>
        {list.map((item) => (
          <button
            className={styles.item}
            onClick={() => onSelect(item)}
            disabled={getIsLoading?.(item) || getDisabled?.(item)}
            key={getKey(item)}
          >
            <Image src={getImage(item)} width={28} height={28} />
            <span className={styles.name}>{getName(item)}</span>
            {getIsLoading?.(item) && <Loader size={16} />}
          </button>
        ))}
      </div>
    </Scrollable>
  )
}

export default List
