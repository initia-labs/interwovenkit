import { useState } from "react"
import { IconBack } from "@initia/icons-react"
import { Link, useHistory } from "@/lib/router"
import { PageScrollContext } from "./PageScrollContext"
import Scrollable from "./Scrollable"
import styles from "./Page.module.css"

import type { PropsWithChildren, ReactNode } from "react"

interface Props {
  title: string
  backButton?: string
  extra?: ReactNode
}

const Page = ({ title, backButton, extra, children }: PropsWithChildren<Props>) => {
  const history = useHistory()
  const [scrollRoot, setScrollRoot] = useState<HTMLDivElement | null>(null)

  return (
    <>
      <header className={styles.header}>
        <Link
          to={backButton ?? (history.length > 1 ? -1 : "/")}
          className={styles.back}
          shouldReset={!!backButton}
          aria-label="Go back"
        >
          <IconBack size={16} aria-hidden="true" />
        </Link>

        <h1 className={styles.title}>{title}</h1>

        {extra}
      </header>

      <PageScrollContext.Provider value={scrollRoot}>
        <Scrollable ref={setScrollRoot}>{children}</Scrollable>
      </PageScrollContext.Provider>
    </>
  )
}

export default Page
