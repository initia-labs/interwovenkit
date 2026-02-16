import react from "@vitejs/plugin-react-swc"
import { defineConfig } from "vite"
import pkg from "../../packages/interwovenkit-react/package.json"

export default defineConfig({
  define: {
    __INTERWOVENKIT_VERSION__: JSON.stringify(pkg.version),
  },
  plugins: [react()],
  envPrefix: "INITIA_",
})
