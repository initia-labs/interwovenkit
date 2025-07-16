import type { PropsWithChildren, ReactNode } from "react"
import { IconBack } from "@initia/icons-react"
import { Link } from "@/lib/router"
import Scrollable from "./Scrollable"
import styles from "./Page.module.css"

interface Props {
  title: string
  returnTo?: string | false
  extra?: ReactNode
  backButtonAmplitudeEvent?: string
}

const Page = ({
  title,
  returnTo,
  extra,
  children,
  backButtonAmplitudeEvent,
}: PropsWithChildren<Props>) => {
  return (
    <>
      <header className={styles.header}>
        {returnTo !== false && (
          <Link
            to={returnTo ?? -1}
            className={styles.back}
            data-amp-track-name={backButtonAmplitudeEvent}
          >
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
