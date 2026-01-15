import clsx from "clsx"
import type { Control, FieldValues, Path, RegisterOptions } from "react-hook-form"
import { Controller } from "react-hook-form"
import { mergeRefs } from "react-merge-refs"
import { NumericFormat } from "react-number-format"
import { useAutoFocus } from "./hooks"
import styles from "./NumericInput.module.css"

import type { InputHTMLAttributes } from "react"

interface Props<T extends FieldValues> extends InputHTMLAttributes<HTMLInputElement> {
  name: Path<T>
  control: Control<T>
  dp?: number
  rules?: Omit<
    RegisterOptions<T, Path<T>>,
    "disabled" | "setValueAs" | "valueAsNumber" | "valueAsDate"
  >
}

function NumericInput<T extends FieldValues>(props: Props<T>) {
  const { name, control, dp = 6, className, rules, ...attrs } = props
  const autoFocusRef = useAutoFocus()

  return (
    <Controller
      name={name}
      control={control}
      rules={rules}
      render={({ field }) => (
        <NumericFormat
          value={field.value}
          getInputRef={mergeRefs([field.ref, autoFocusRef])}
          className={clsx(styles.input, className)}
          onValueChange={(values) => {
            field.onChange(values.value)
          }}
          onBlur={field.onBlur}
          decimalScale={dp}
          allowNegative={false}
          placeholder="0"
          inputMode="decimal"
          autoComplete="off"
          {...attrs}
        />
      )}
    />
  )
}

export default NumericInput
