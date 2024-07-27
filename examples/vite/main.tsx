import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import "./index.css"
import Providers from "./src/Providers"
import App from "./src/App"

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Providers>
      <App />
    </Providers>
  </StrictMode>,
)
