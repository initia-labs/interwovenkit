/* eslint-disable no-console */
import fs from "fs"
import path from "path"
import type { Plugin } from "vite"
import { defineConfig } from "vite"
import react from "@vitejs/plugin-react-swc"
import dts from "vite-plugin-dts"
import pkg from "./package.json"

function emitCssAsJsString(): Plugin {
  return {
    name: "emit-css-as-js-string",
    apply: "build",
    closeBundle() {
      const outDir = path.resolve(__dirname, "dist")
      const cssPath = path.join(outDir, "styles.css")
      const jsPath = path.join(outDir, "styles.js")
      const dtsPath = path.join(outDir, "styles.d.ts")

      if (fs.existsSync(cssPath)) {
        const cssContent = fs.readFileSync(cssPath, "utf-8")
        const jsModule = `export default ${JSON.stringify(cssContent)};`
        fs.writeFileSync(jsPath, jsModule)
        console.log("✅ Generated styles.js")
        const dtsContent = "declare const styles: string\nexport default styles\n"
        fs.writeFileSync(dtsPath, dtsContent)
        console.log("✅ Generated styles.d.ts")
      } else {
        console.error("❌ styles.css not found.")
      }
    },
  }
}

function patchPeerDepsImportsPlugin(): Plugin {
  const prefixesToFix = [
    "cosmjs-types",
    "@cosmjs/amino/build/signdoc",
    "@initia/opinit.proto/opinit/ophost/v1/tx",
  ]

  return {
    name: "patch-peer-deps-imports",
    renderChunk(code) {
      const importRegex = /(from\s+["'])([^"']+)(["'])/g

      const fixedCode = code.replaceAll(importRegex, (match, p1, p2, p3) => {
        if (prefixesToFix.some((prefix) => p2.startsWith(prefix)) && !path.extname(p2)) {
          return `${p1}${p2}.js${p3}`
        }
        return match
      })

      return {
        code: fixedCode,
      }
    },
  }
}

export default defineConfig(({ mode }) => {
  return {
    plugins: [
      dts({ rollupTypes: mode !== "fast" }),
      react(),
      patchPeerDepsImportsPlugin(),
      emitCssAsJsString(),
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
        external: (id) => {
          const peerDeps = Object.keys(pkg.peerDependencies || {})
          return peerDeps.some((dep) => id === dep || id.startsWith(`${dep}/`))
        },
      },
    },
  }
})
