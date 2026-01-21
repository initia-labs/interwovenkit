import { useAtom } from "jotai"
import Bridge from "./Bridge"
import Connection from "./Connection"
import { isTestnet, themeAtom } from "./data"
import Deposit from "./Deposit"
import Send from "./Send"
import ToggleAutoSign from "./ToggleAutoSign"
import Withdraw from "./Withdraw"
import styles from "./App.module.css"

const App = () => {
  const [theme, setTheme] = useAtom(themeAtom)
  const toggleTheme = () => setTheme((prev) => (prev === "dark" ? "light" : "dark"))

  return (
    <>
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
          <Bridge />
          <Deposit />
          <Withdraw />
          <ToggleAutoSign />
          <Connection />
        </div>
      </header>
      <main className={styles.container}>
        <Send />
      </main>
    </>
  )
}

export default App
