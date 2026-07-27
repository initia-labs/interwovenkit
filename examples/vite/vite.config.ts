import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"
import pkg from "../../packages/interwovenkit-react/package.json"

export default defineConfig({
  define: {
    __INTERWOVENKIT_VERSION__: JSON.stringify(pkg.version),
  },
  plugins: [react()],
  envPrefix: "INITIA_",
  server: {
    port: 17303,
    strictPort: true,
  },
})
