import { useAtom } from "jotai"
import Bridge from "./Bridge"
import Connection from "./Connection"
import { chainId, themeAtom } from "./data"
import Send from "./Send"
import styles from "./App.module.css"

const App = () => {
  const [theme, setTheme] = useAtom(themeAtom)
  const toggleTheme = () => setTheme((prev) => (prev === "dark" ? "light" : "dark"))

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <h1 className={styles.title} data-testnet>
          {chainId}
        </h1>
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
