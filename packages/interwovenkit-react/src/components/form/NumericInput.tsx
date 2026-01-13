import clsx from "clsx"
import { useState } from "react"
import type { Control, FieldValues, Path, RegisterOptions } from "react-hook-form"
import { Controller } from "react-hook-form"
import { mergeRefs } from "react-merge-refs"
import { useAutoFocus } from "./hooks"
import styles from "./NumericInput.module.css"

import type { InputHTMLAttributes } from "react"

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
  const [displayValue, setDisplayValue] = useState<string | undefined>(undefined)

  return (
    <Controller
      name={name}
      control={control}
      rules={rules}
      render={({ field }) => {
        const handleChange = (newValue: string) => {
          const sanitized = sanitizeNumericInput(newValue, dp)
          setDisplayValue(sanitized)

          if (Number(field.value || 0) !== Number(sanitized || 0)) {
            field.onChange(sanitized)
          }
        }

        const parsedDisplayValue =
          Number(field.value || 0) === Number(displayValue || 0)
            ? (displayValue ?? field.value)
            : field.value

        return (
          <input
            {...field}
            value={parsedDisplayValue}
            className={clsx(styles.input, className)}
            onChange={(e) => handleChange(e.target.value)}
            onPaste={(e) => {
              e.preventDefault()
              const pastedText = e.clipboardData.getData("text")

              // Check if it's a formatted number (e.g., 1,234,567.890)
              const formattedNumberRegex = /^[0-9,]+(\.[0-9]+)?$/
              if (!formattedNumberRegex.test(pastedText)) return

              const cleanedValue = pastedText.replace(/,/g, "")
              handleChange(cleanedValue)
            }}
            placeholder="0"
            inputMode="decimal"
            autoComplete="off"
            {...attrs}
            ref={mergeRefs([field.ref, autoFocusRef])}
          />
        )
      }}
    />
  )
}

export default NumericInput
