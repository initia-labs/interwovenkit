import type { ReactNode } from "react"
import { Accordion } from "radix-ui"
import { IconChevronDown } from "@initia/icons-react"
import styles from "./WidgetAccordion.module.css"

interface Props<T> {
  list: T[]
  getKey?: (item: T) => string
  renderHeader: (item: T) => ReactNode
  renderContent: (item: T) => ReactNode
  footer?: ReactNode

  value?: string[]
  onValueChange?: (value: string[]) => void
  amplitudeOpenEventName?: string
  getAmplitudeDetails?: (item: T) => Record<string, unknown>
}

function WidgetAccordion<T>(props: Props<T>) {
  const {
    list,
    getKey,
    renderHeader,
    renderContent,
    footer,
    amplitudeOpenEventName,
    getAmplitudeDetails,
    ...attrs
  } = props
  return (
    <Accordion.Root className={styles.root} type="multiple" {...attrs}>
      {list.map((item, index) => (
        <Accordion.Item
          className={styles.item}
          value={getKey?.(item) ?? String(index)}
          key={getKey?.(item) ?? index}
        >
          <Accordion.Header>
            <Accordion.Trigger
              className={styles.trigger}
              data-amp-track-name={amplitudeOpenEventName}
              {...getAmplitudeDetails?.(item)}
            >
              {renderHeader(item)}
              <IconChevronDown className={styles.chevron} size={16} />
            </Accordion.Trigger>
          </Accordion.Header>

          <Accordion.Content className={styles.content}>{renderContent(item)}</Accordion.Content>
        </Accordion.Item>
      ))}

      {footer}
    </Accordion.Root>
  )
}

export default WidgetAccordion
