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

  // Paste is deliberately left to NumericFormat's default strip-and-join,
  // even though it mangles some formats ("1234,56" -> "123456", "1e5" -> "15").
  // The constraints — never block paste, no silent transformation, form-state/
  // display parity — are jointly unsatisfiable: a client-side normalizer only
  // re-encodes the trade-off as locale-guessing heuristics (is "1,234" grouping
  // or a decimal?) whose ambiguity rules breed their own edge cases and bugs.
  // Locale-aware parsing belongs upstream in the input library, not in ad-hoc
  // regexes here. Accepted trade-off: exotic pastes keep their digits only.
  return (
    <Controller
      name={name}
      control={control}
      rules={rules}
      render={({ field }) => (
        <NumericFormat
          // @ts-expect-error - field.value type compatibility
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
