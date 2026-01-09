import { useAtom } from "jotai"
import Connection from "./Connection"
import { themeAtom } from "./data"
import SignCustomMessages from "./SignCustomMessages"
import styles from "./App.module.css"

const App = () => {
  const [theme, setTheme] = useAtom(themeAtom)
  const toggleTheme = () => setTheme((prev) => (prev === "dark" ? "light" : "dark"))

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <h1 className={styles.title}>Custom</h1>
        <div className={styles.controls}>
          <button className={styles.toggle} onClick={toggleTheme}>
            {theme === "light" ? "Dark" : "Light"}
          </button>
          <Connection />
        </div>
      </header>

      <SignCustomMessages />
    </div>
  )
}

export default App
