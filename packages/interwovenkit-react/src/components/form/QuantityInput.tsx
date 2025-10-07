import BigNumber from "bignumber.js"
import clsx from "clsx"
import { useFormContext } from "react-hook-form"
import { toBaseUnit } from "@initia/utils"
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
}

const QuantityInput = ({ balance, decimals }: Props) => {
  const { control } = useFormContext()

  const rules = {
    required: "Enter amount",
    validate: (quantity: string) => {
      if (BigNumber(quantity).isZero()) {
        return "Enter amount"
      }

      if (BigNumber(toBaseUnit(quantity, { decimals })).gt(balance ?? 0)) {
        return "Insufficient balance"
      }

      return true
    },
  }

  return <NumericInput name="quantity" control={control} className={styles.input} rules={rules} />
}

QuantityInput.ReadOnly = QuantityInputReadOnly

export default QuantityInput
