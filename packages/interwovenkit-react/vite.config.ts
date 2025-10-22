/* eslint-disable no-console */
import react from "@vitejs/plugin-react-swc"
import fs from "fs"
import path from "path"
import type { Plugin } from "vite"
import { defineConfig } from "vite"
import dts from "vite-plugin-dts"

function emitCssAsJsString(): Plugin {
  return {
    name: "emit-css-as-js-string",
    apply: "build",
    closeBundle() {
      const outDir = path.resolve(__dirname, "dist")
      const cssPath = path.join(outDir, "styles.css")
      const jsPath = path.join(outDir, "styles.js")
      const cjsPath = path.join(outDir, "styles.cjs")
      const dtsPath = path.join(outDir, "styles.d.ts")

      if (fs.existsSync(cssPath)) {
        const cssContent = fs.readFileSync(cssPath, "utf-8")

        // ESM format
        const esmModule = `export default ${JSON.stringify(cssContent)};`
        fs.writeFileSync(jsPath, esmModule)
        console.log("✅ Generated styles.js (ESM)")

        // CJS format
        const cjsModule = `module.exports = ${JSON.stringify(cssContent)};`
        fs.writeFileSync(cjsPath, cjsModule)
        console.log("✅ Generated styles.cjs (CJS)")

        const dtsContent = "declare const styles: string\nexport default styles\n"
        fs.writeFileSync(dtsPath, dtsContent)
        console.log("✅ Generated styles.d.ts")
      } else {
        console.error("❌ styles.css not found.")
      }
    },
  }
}

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
    plugins: [
      dts({ rollupTypes: mode !== "fast" }),
      react(),
      emitCssAsJsString(),
      appendJsExtension(),
    ],
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
