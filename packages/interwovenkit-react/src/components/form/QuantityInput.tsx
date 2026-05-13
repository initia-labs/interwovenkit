import clsx from "clsx"
import { useFormContext } from "react-hook-form"
import { isInsufficientBalance, parseQuantity } from "@/lib/amountValidation"
import NumericInput from "./NumericInput"
import styles from "./QuantityInput.module.css"

const QuantityInputReadOnly = ({ children }: { children: string }) => {
  // `children` is a pre-formatted display string from `formatAmount`, which adds
  // comma thousand separators (e.g. "1,000.000000"). Strip them before parseQuantity
  // because BigNumber strict mode rejects commas as invalid input.
  const parsed = parseQuantity(children.replace(/,/g, ""))
  const isPlaceholder = !parsed || parsed.isZero()
  return <p className={clsx(styles.input, { [styles.placeholder]: isPlaceholder })}>{children}</p>
}

interface Props {
  balance?: string
  decimals?: number
  className?: string
}

const QuantityInput = ({ balance, decimals, className }: Props) => {
  const { control } = useFormContext()

  const rules = {
    required: "Enter amount",
    validate: (quantity: string) => {
      const parsed = parseQuantity(quantity)
      if (!parsed || parsed.lte(0)) {
        return "Enter amount"
      }

      if (isInsufficientBalance({ quantity, balance, decimals })) {
        return "Insufficient balance"
      }

      return true
    },
  }

  return (
    <NumericInput
      name="quantity"
      control={control}
      className={clsx(styles.input, className)}
      rules={rules}
    />
  )
}

QuantityInput.ReadOnly = QuantityInputReadOnly

export default QuantityInput
