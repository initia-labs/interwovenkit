import { useAtom } from "jotai"
import Bridge from "./Bridge"
import Connection from "./Connection"
import { isTestnet, themeAtom } from "./data"
import Send from "./Send"
import ToggleAutoSign from "./ToggleAutoSign"
import styles from "./App.module.css"

const App = () => {
  const [theme, setTheme] = useAtom(themeAtom)
  const toggleTheme = () => setTheme((prev) => (prev === "dark" ? "light" : "dark"))

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        {isTestnet ? (
          <h1 className={styles.title} data-testnet>
            Initia Testnet
          </h1>
        ) : (
          <h1 className={styles.title}>Initia</h1>
        )}
        <div className={styles.controls}>
          <button className={styles.toggle} onClick={toggleTheme}>
            {theme === "light" ? "Dark" : "Light"}
          </button>
          <Connection />
        </div>
      </header>

      <Send />
      <ToggleAutoSign chainId="interwoven-1" />
      <ToggleAutoSign chainId="civitia-1" />
      <ToggleAutoSign chainId="echelon-1" />
      <ToggleAutoSign chainId="moo-1" />

      <Bridge />
    </div>
  )
}

export default App
