import path from "path"
import type { Plugin } from "vite"
import { defineConfig } from "vite"
import react from "@vitejs/plugin-react-swc"
import dts from "vite-plugin-dts"

function appendJsExtension(): Plugin {
  return {
    name: "append-js-extension",
    apply: "build",
    renderChunk(code) {
      const targetPackages = ["cosmjs-types", "@cosmjs/amino"]

      return targetPackages.reduce((currentCode, pkg) => {
        const regex = new RegExp(`from\\s+['"](${pkg}/[^'"]*?)['"]`, "g")
        return currentCode.replace(regex, (match, importPath) => {
          return match.replace(importPath, importPath + ".js")
        })
      }, code)
    },
  }
}

export default defineConfig(({ mode }) => {
  return {
    plugins: [dts({ rollupTypes: mode !== "fast" }), react(), appendJsExtension()],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "src"),
      },
    },
    build: {
      lib: {
        entry: path.resolve(__dirname, "src/index.ts"),
        formats: ["es", "cjs"],
        fileName: (format) => (format === "es" ? "index.js" : "index.cjs"),
        cssFileName: "styles",
      },
      rollupOptions: {
        external: (id) => !(id.startsWith(".") || id.startsWith("/") || id.startsWith("@/")),
      },
    },
  }
})
