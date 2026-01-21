import { useState } from "react"
import { useAtom } from "jotai"
import { IconClose, IconMenu } from "@initia/icons-react"
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
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const toggleMenu = () => setIsMenuOpen((prev) => !prev)

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
          <div className={styles.desktopButtons}>
            <Deposit />
            <Withdraw />
            <Bridge />
            <ToggleAutoSign />
          </div>

          <Connection />
          <button className={styles.hamburger} onClick={toggleMenu} aria-label="Menu">
            {isMenuOpen ? <IconClose size={18} /> : <IconMenu size={18} />}
          </button>
        </div>
      </header>
      {isMenuOpen && (
        <div className={styles.mobileMenu}>
          <Deposit />
          <Withdraw />
          <Bridge />
          <ToggleAutoSign />
        </div>
      )}
      <main className={styles.container}>
        <Send />
      </main>
    </>
  )
}

export default App
