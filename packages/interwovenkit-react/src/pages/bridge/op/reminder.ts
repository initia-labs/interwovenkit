import { isPast } from "date-fns"
import { useEffect, useCallback, useMemo, createElement } from "react"
import { useAtom } from "jotai"
import { atomWithStorage } from "jotai/utils"
import { useNavigate } from "@/lib/router"
import { useInitiaAddress } from "@/public/data/hooks"
import { useModal } from "@/public/app/ModalContext"
import { LocalStorageKey } from "@/data/constants"
import type { TxIdentifier } from "../data/history"
import ClaimableList from "./ClaimableList"

export interface ReminderDetails extends TxIdentifier {
  recipient: string // initia address
  amount: string
  denom: string
  claimableAt: number
  dismissed?: boolean
}

function isSameTx(a: TxIdentifier, b: TxIdentifier) {
  return a.chainId === b.chainId && a.txHash === b.txHash
}

const detailKeyOf = ({ chainId, txHash }: TxIdentifier) =>
  `${LocalStorageKey.OP_REMINDER}:${chainId}:${txHash}`

const opRemindersAtom = atomWithStorage<TxIdentifier[]>(LocalStorageKey.OP_REMINDER, [])

export function useClaimableReminders() {
  const initiaAddress = useInitiaAddress()
  const [list = [], setList] = useAtom(opRemindersAtom)

  const reminders = useMemo(() => {
    return list
      .map((tx) => {
        const raw = localStorage.getItem(detailKeyOf(tx))
        if (!raw) return null
        return JSON.parse(raw)
      })
      .filter((item): item is ReminderDetails => {
        if (!item) return false
        const { recipient, claimableAt } = item
        if (recipient !== initiaAddress) return false
        return isPast(claimableAt)
      })
  }, [initiaAddress, list])

  const addReminder = useCallback(
    (tx: TxIdentifier, details: ReminderDetails) => {
      // Avoid duplicates
      if (list.some((item) => isSameTx(item, tx))) return
      setList((prev = []) => [...prev, tx])
      localStorage.setItem(detailKeyOf(tx), JSON.stringify(details))
    },
    [list, setList],
  )

  const removeReminder = useCallback(
    (tx: TxIdentifier) => {
      setList((prev = []) => prev.filter((item) => !isSameTx(item, tx)))
      localStorage.removeItem(detailKeyOf(tx))
    },
    [setList],
  )

  const syncReminders = useCallback(
    (txs: TxIdentifier[]) => {
      const newOnes = txs.filter((tx) => !list.some((item) => isSameTx(item, tx)))
      if (newOnes.length === 0) return
      setList((prev = []) => [...prev, ...newOnes])
    },
    [list, setList],
  )

  const setReminder = useCallback(
    (tx: TxIdentifier, details: ReminderDetails) => {
      localStorage.setItem(detailKeyOf(tx), JSON.stringify(details))
      setList((prev = []) => [...prev]) // to trigger re-render
    },
    [setList],
  )

  return { reminders, addReminder, removeReminder, syncReminders, setReminder }
}

export function useClaimableModal() {
  const navigate = useNavigate()
  const { openModal, closeModal } = useModal()

  const { reminders, setReminder } = useClaimableReminders()

  // Open a modal if there are any claimable withdrawals that haven't been dismissed
  useEffect(() => {
    const list = reminders.filter((item) => !item.dismissed)
    if (list.length === 0) {
      return
    }

    const onNavigate = () => {
      // If all items share the same chainId, navigate with that chainId parameter
      const chainId = list.every((item) => item.chainId === list[0].chainId)
        ? list[0].chainId
        : undefined
      navigate("/op/withdrawals", { chainId })
      finalize()
    }

    const finalize = () => {
      closeModal()
      for (const item of list) {
        setReminder(item, { ...item, dismissed: true })
      }
    }

    openModal({
      content: createElement(ClaimableList, { list, onNavigate, onDismiss: finalize }),
    })
  }, [reminders, closeModal, navigate, openModal, setReminder])
}
