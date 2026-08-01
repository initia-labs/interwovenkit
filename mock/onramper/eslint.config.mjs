import config from "../../eslint.config.mjs"

// A Node server process: console output is its log surface (the root config
// also carves mock/** out of no-console, but its file pattern is relative to
// the repo root and does not apply when linting from this package).
export default [...config, { rules: { "no-console": "off" } }]
