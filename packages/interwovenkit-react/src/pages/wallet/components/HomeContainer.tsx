import type { PropsWithChildren } from "react"
import type { Props as SearchInputProps } from "@/components/form/SearchInput"
import SearchInput from "@/components/form/SearchInput"
import styles from "./HomeContainer.module.css"

const HomeContainerRoot = ({ children }: PropsWithChildren) => {
  return <div className={styles.container}>{children}</div>
}

const HomeContainerControls = ({ children }: PropsWithChildren) => {
  return <div className={styles.controls}>{children}</div>
}

const HomeContainerSearchInput = (props: SearchInputProps) => {
  return <SearchInput {...props} rootClassName={styles.search} />
}

const HomeContainer = {
  Root: HomeContainerRoot,
  Controls: HomeContainerControls,
  SearchInput: HomeContainerSearchInput,
}

export default HomeContainer
