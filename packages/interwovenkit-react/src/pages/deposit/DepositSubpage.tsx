import clsx from "clsx"
import DepositBackButton from "./DepositBackButton"
import styles from "./DepositSubpage.module.css"

import type { PropsWithChildren } from "react"

interface Props {
  /** Screens pass their own copy. Method pages derive it from the hub button
   * copy plus the asset inserted ("Deposit via address" → "Deposit {X} via
   * address"), confirming the user's pick. */
  title: string
  /** When provided, renders a back arrow that returns to the previous page. */
  onBack?: () => void
}

/**
 * Shared shell for deposit sub-pages: a back arrow + centered title above the
 * page body. Navigates via a form `page` field (`onBack`), not the router. The
 * back arrow is pinned to the modal chrome (not the title row) so it sits level
 * with the surface-owned close (X) button (see DepositBackButton).
 */
const DepositSubpage = ({ title, onBack, children }: PropsWithChildren<Props>) => {
  return (
    <>
      {onBack && <DepositBackButton onClick={onBack} />}

      <h2 className={styles.title}>{title}</h2>

      {children}
    </>
  )
}

interface ListProps {
  /** Extra class for per-screen sizing (e.g. a min-height for skeletons). */
  className?: string
  /** Overrides the default height cap. Applied inline so it cannot lose to the
   * base class on CSS module injection order. */
  maxHeight?: string
  /** Set false when a child owns its own scroll region (e.g. AssetOptions):
   * the list then only bounds the height and the child shrinks to fit. */
  scroll?: boolean
}

/**
 * Full-bleed list shared by deposit sub-page list screens: cancels the surface
 * padding so rows run edge to edge, and caps the height so long lists scroll.
 * Corner clipping is owned by the page surface (`DepositSurface.module.css`
 * `.surface`, overflow: hidden), so rows may paint square hover backgrounds to
 * the frame edges.
 */
const DepositSubpageList = (props: PropsWithChildren<ListProps>) => {
  const { className, maxHeight, scroll = true, children } = props
  return (
    <div
      className={clsx(styles.list, scroll && styles.scroll, className)}
      style={maxHeight ? { maxHeight } : undefined}
    >
      {children}
    </div>
  )
}

DepositSubpage.List = DepositSubpageList

interface RowProps {
  onClick: () => void
  /** Highlights the row as the current selection (e.g. the chosen provider). */
  isActive?: boolean
}

/**
 * Option row inside a DepositSubpage.List: full-width button with a divider,
 * a hover/active background, and the shared row padding. Content (icon, name,
 * trailing check or amounts) is composed by the caller.
 */
const DepositSubpageRow = ({ onClick, isActive, children }: PropsWithChildren<RowProps>) => {
  return (
    <button
      type="button"
      className={clsx(styles.row, isActive && styles.activeRow)}
      onClick={onClick}
    >
      {children}
    </button>
  )
}

DepositSubpage.Row = DepositSubpageRow

export default DepositSubpage
