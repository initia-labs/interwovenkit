import { defineConfig } from "vite-plus"

export default defineConfig({
  fmt: {
    printWidth: 100,
    semi: false,
  },
  lint: {
    jsPlugins: ["@tanstack/eslint-plugin-query"],
    options: {
      typeAware: true,
      typeCheck: true,
    },
  },
  staged: {
    "*.{ts,tsx}": "vp check --fix",
    "*.css": ["vp fmt", "stylelint --fix"],
    "*.{json,md}": "vp fmt",
  },
})
