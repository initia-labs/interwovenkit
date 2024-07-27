import path from "path"
import { mergeConfig } from "vite"
import baseConfig from "./vite.config"

const pkg = path.resolve(__dirname, "../../packages/interwovenkit-react")

export default mergeConfig(baseConfig, {
  resolve: {
    alias: {
      "@initia/interwovenkit-react/styles.css?inline": path.resolve(pkg, "dist/styles.css?inline"),
      "@initia/interwovenkit-react/styles.css": path.resolve(pkg, "dist/styles.css"),
      "@initia/interwovenkit-react": path.resolve(pkg, "src"),
      "@": path.resolve(pkg, "src"),
    },
  },
})
