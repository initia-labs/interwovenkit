import type { PropsWithChildren, ReactNode } from "react"
import { IconBack } from "@initia/icons-react"
import { Link } from "@/lib/router"
import Scrollable from "./Scrollable"
import styles from "./Page.module.css"

interface Props {
  title: string
  backButton?: ReactNode
  extra?: ReactNode
}

const Page = ({ title, backButton, extra, children }: PropsWithChildren<Props>) => {
  return (
    <>
      <header className={styles.header}>
        {backButton ?? (
          <Link to={-1} className={styles.back}>
            <IconBack size={16} />
          </Link>
        )}

        <h1 className={styles.title}>{title}</h1>

        {extra}
      </header>

      <Scrollable>{children}</Scrollable>
    </>
  )
}

export default Page
