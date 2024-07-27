import { useAtom } from "jotai"
import { isTestnet, themeAtom } from "./data"
import Connection from "./Connection"
import Send from "./Send"
import Bridge from "./Bridge"
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
      <Bridge />
    </div>
  )
}

export default App
