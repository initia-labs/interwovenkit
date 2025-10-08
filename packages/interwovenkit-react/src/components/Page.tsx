import { IconBack } from "@initia/icons-react"
import { Link } from "@/lib/router"
import Scrollable from "./Scrollable"
import styles from "./Page.module.css"

import type { PropsWithChildren, ReactNode } from "react"

interface Props {
  title: string
  backButton?: string
  extra?: ReactNode
}

const Page = ({ title, backButton, extra, children }: PropsWithChildren<Props>) => {
  return (
    <>
      <header className={styles.header}>
        <Link to={backButton ?? -1} className={styles.back} shouldReset={!!backButton}>
          <IconBack size={16} />
        </Link>

        <h1 className={styles.title}>{title}</h1>

        {extra}
      </header>

      <Scrollable>{children}</Scrollable>
    </>
  )
}

export default Page
