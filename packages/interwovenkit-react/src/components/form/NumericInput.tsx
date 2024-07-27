import clsx from "clsx"
import type { InputHTMLAttributes } from "react"
import { mergeRefs } from "react-merge-refs"
import type { Control, FieldValues, Path, RegisterOptions } from "react-hook-form"
import { Controller } from "react-hook-form"
import { useAutoFocus } from "./hooks"
import styles from "./NumericInput.module.css"

function sanitizeNumericInput(value: string, maxLength: number): string {
  const cleaned = value.replace(/[^0-9.]/g, "")
  const [int, ...dec] = cleaned.split(".")
  return dec.length === 0 ? int : `${int}.${dec.join("").slice(0, maxLength)}`
}

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
        <input
          {...field}
          className={clsx(styles.input, className)}
          onChange={(e) => field.onChange(sanitizeNumericInput(e.target.value, dp))}
          placeholder="0"
          inputMode="decimal"
          autoComplete="off"
          {...attrs}
          ref={mergeRefs([field.ref, autoFocusRef])}
        />
      )}
    />
  )
}

export default NumericInput
