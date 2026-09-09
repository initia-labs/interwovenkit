import { Fragment } from "react"
import Image from "@/components/Image"
import styles from "./DepositMethodList.module.css"

import type { ComponentType, ReactNode } from "react"

// Generic in `Id` so a caller's method-id union survives to `onSelect` — a
// typo'd id fails to compile instead of silently hitting a dispatch fallthrough.
export interface DepositMethodItem<Id extends string = string> {
  id: Id
  title: string
  /** Gray helper line under the title; a node so a method can render live data
   * (e.g. the cash method's fetched purchase limit) behind its own boundary. */
  subtext: ReactNode
  Icon: ComponentType<{ size?: number }>
  /** When set, render this image (e.g. the connected wallet's icon) instead of
   * Icon; Icon stays the fallback while it loads or if the image errors. */
  iconUrl?: string
  disabled?: boolean
}

export interface DepositMethodSection<Id extends string = string> {
  /** Section header label, e.g. "Crypto" / "Cash". */
  label: string
  methods: DepositMethodItem<Id>[]
}

interface Props<Id extends string> {
  sections: DepositMethodSection<Id>[]
  onSelect: (id: Id) => void
}

/** Hub list of deposit methods grouped into sections. */
const DepositMethodList = <Id extends string>({ sections, onSelect }: Props<Id>) => {
  return (
    <div className={styles.list}>
      {sections.map((section) => (
        <Fragment key={section.label}>
          <p className={styles.section}>{section.label}</p>

          {section.methods.map(({ id, title, subtext, Icon, iconUrl, disabled }) => (
            <button
              type="button"
              className={styles.method}
              key={id}
              onClick={() => onSelect(id)}
              disabled={disabled}
            >
              <span className={styles.icon}>
                {iconUrl ? (
                  <Image src={iconUrl} width={24} height={24} placeholder={<Icon size={24} />} />
                ) : (
                  <Icon size={24} />
                )}
              </span>

              <span className={styles.details}>
                <span className={styles.title}>{title}</span>
                <span className={styles.subtext}>{subtext}</span>
              </span>
            </button>
          ))}
        </Fragment>
      ))}
    </div>
  )
}

export default DepositMethodList
