import BigNumber from "bignumber.js"
import clsx from "clsx"
import { useFormContext } from "react-hook-form"
import { isInsufficientBalance } from "@/lib/amountValidation"
import NumericInput from "./NumericInput"
import styles from "./QuantityInput.module.css"

const QuantityInputReadOnly = ({ children }: { children: string }) => {
  return (
    <p className={clsx(styles.input, { [styles.placeholder]: BigNumber(children).isZero() })}>
      {children}
    </p>
  )
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
      if (BigNumber(quantity).isZero()) {
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
