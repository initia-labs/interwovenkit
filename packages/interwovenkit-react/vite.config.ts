/* eslint-disable no-console */
import react from "@vitejs/plugin-react"
import fs from "fs"
import path from "path"
import { defineConfig } from "vite-plus"
import pkg from "./package.json"

function emitCssAsJsString() {
  return {
    name: "emit-css-as-js-string",
    closeBundle() {
      const outDir = path.resolve(__dirname, "dist")
      const cssPath = path.join(outDir, "styles.css")
      if (!fs.existsSync(cssPath)) return

      const cssContent = fs.readFileSync(cssPath, "utf-8")
      fs.writeFileSync(
        path.join(outDir, "styles.js"),
        `export default ${JSON.stringify(cssContent)};`,
      )
      console.log("✅ Generated styles.js")
      fs.writeFileSync(
        path.join(outDir, "styles.d.ts"),
        "declare const styles: string\nexport default styles\n",
      )
      console.log("✅ Generated styles.d.ts")
    },
  }
}

// Inline SVG imports as data URIs (replaces Vite's built-in asset handling)
function svgDataUri() {
  return {
    name: "svg-data-uri",
    load(id: string) {
      if (!id.endsWith(".svg")) return
      const content = fs.readFileSync(id, "utf-8")
      const encoded = Buffer.from(content).toString("base64")
      return `export default "data:image/svg+xml;base64,${encoded}";`
    },
  }
}

// Append .js to deep imports from packages with incomplete ESM exports
function appendJsExtension() {
  return {
    name: "append-js-extension",
    renderChunk(code: string) {
      const targetPackages = ["cosmjs-types", "@cosmjs/amino"]
      return targetPackages.reduce((currentCode, packageName) => {
        const regex = new RegExp(`from\\s+['"](${packageName}/[^'"]*?)['"]`, "g")
        return currentCode.replace(regex, (match: string, importPath: string) => {
          if (importPath.endsWith(".js")) return match
          return match.replace(importPath, importPath + ".js")
        })
      }, code)
    },
  }
}

// @ts-expect-error vite-plus defineConfig type does not include test/pack blocks
export default defineConfig(() => {
  return {
    test: {
      globals: true,
      include: ["**/*.test.ts"],
    },
    define: {
      __INTERWOVENKIT_VERSION__: JSON.stringify(pkg.version),
    },
    plugins: [react()],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "src"),
      },
    },
    pack: {
      entry: path.resolve(__dirname, "src/index.ts"),
      dts: { tsgo: true },
      format: ["esm", "cjs"],
      define: {
        __INTERWOVENKIT_VERSION__: JSON.stringify(pkg.version),
      },
      css: { fileName: "styles.css" },
      deps: { skipNodeModulesBundle: true },
      plugins: [svgDataUri(), emitCssAsJsString(), appendJsExtension()],
    },
  }
})
