import config from "@initia/eslint-config-react-app"

export default [
  ...config,
  {
    files: ["mock/**/*.ts"],
    // These CLI servers use stdout and stderr as their logging interface.
    rules: { "no-console": "off" },
  },
]
