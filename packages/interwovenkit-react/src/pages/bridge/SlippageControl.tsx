import clsx from "clsx"
import { useEffect, useMemo, useState } from "react"
import { useForm } from "react-hook-form"
import Scrollable from "@/components/Scrollable"
import Footer from "@/components/Footer"
import Button from "@/components/Button"
import NumericInput from "@/components/form/NumericInput"
import FormHelp from "@/components/form/FormHelp"
import { useBridgeForm } from "./data/form"
import styles from "./SlippageControl.module.css"

const PRESETS = ["0.1", "0.5", "1.0"]

interface FormValues {
  value: string
}

const SlippageControl = ({ afterConfirm }: { afterConfirm: () => void }) => {
  const bridgeForm = useBridgeForm()
  const defaultValue = bridgeForm.getValues("slippagePercent")

  const [activePreset, setActivePreset] = useState<number | null>(null)
  const { control, watch, getValues, setValue } = useForm<FormValues>({
    defaultValues: { value: defaultValue },
  })

  const value = watch("value")

  // Initialize active preset if default matches one
  useEffect(() => {
    const index = PRESETS.findIndex((preset) => preset === defaultValue)
    setActivePreset(index >= 0 ? index : null)
  }, [defaultValue])

  const handlePresetClick = (preset: string, index: number) => {
    setValue("value", preset)
    setActivePreset(index)
  }

  const handleInputFocus = () => {
    setActivePreset(null)
  }

  const message = useMemo(() => {
    if (Number(value) > 100) {
      return { type: "error" as const, text: "Slippage must be less than 100%" }
    }

    if (Number(value) > 5) {
      return { type: "warning" as const, text: "Your transaction may be frontrun" }
    }

    if (Number(value) < 0.1) {
      return { type: "warning" as const, text: "Your transaction may fail" }
    }

    return null
  }, [value])

  const isError = message?.type === "error"

  const onConfirm = ({ value }: FormValues) => {
    bridgeForm.setValue("slippagePercent", value)
    afterConfirm()
  }

  return (
    <Scrollable>
      <p className={styles.description}>
        Slippage is how much price movement you can tolerate between the time you send out a
        transaction and the time it's executed.
      </p>

      <div className={styles.presets}>
        {PRESETS.map((preset, index) => (
          <button
            type="button"
            className={clsx(styles.preset, { [styles.active]: activePreset === index })}
            onClick={() => handlePresetClick(preset, index)}
            key={preset}
          >
            {preset}%
          </button>
        ))}
        {activePreset !== null ? (
          <button
            type="button"
            className={clsx(styles.preset, styles.custom)}
            onClick={() => setActivePreset(null)}
          >
            Custom
          </button>
        ) : (
          <div className={styles.wrapper}>
            <NumericInput
              name="value"
              control={control}
              dp={2}
              onFocus={handleInputFocus}
              placeholder=""
              className={clsx(styles.preset, styles.active)}
            />
            <span className={styles.percent}>%</span>
          </div>
        )}
      </div>

      {message && <FormHelp level={message.type}>{message.text}</FormHelp>}

      <Footer>
        <Button.White type="button" onClick={() => onConfirm(getValues())} disabled={isError}>
          Confirm
        </Button.White>
      </Footer>
    </Scrollable>
  )
}

export default SlippageControl
