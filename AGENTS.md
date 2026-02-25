# InterwovenKit

React 19 library for connecting dApps to Initia and Interwoven Rollups. Provides wallet connection, asset management, cross-chain bridging, and transaction signing as an embeddable widget.

**Package**: `@initia/interwovenkit-react`

## Tech Stack

- **Framework**: React 19, TypeScript 5.9, Vite 7 (SWC)
- **State**: Jotai (UI atoms), TanStack React Query 5 (server state), React Hook Form 7 (forms)
- **Blockchain**: CosmJS 0.36 (Cosmos), wagmi 2 + viem 2 (EVM)
- **Styling**: CSS Modules + CSS custom properties (Shadow DOM compatible)
- **UI Primitives**: Base UI 1.0, Radix UI 1.4, React Spring 10
- **Utilities**: BigNumber.js, ky, ramda, date-fns, xss
- **Testing**: Vitest 4
- **Monorepo**: pnpm workspaces

## Directory Structure

```
packages/interwovenkit-react/src/
  public/              # Public API surface (exported via index.ts)
    app/               # Provider, Modal, Drawer, Routes
    data/              # Exported hooks (useInterwovenKit, useAddress, etc.)
  data/                # Core business logic, queries, atoms
    patches/           # CosmJS monkey patches
    minity/            # Portfolio SSE streaming
  components/          # Reusable UI components
    form/              # Form field components (NumericInput, ChainOptions, etc.)
  pages/               # Route-based feature pages
    wallet/            # Portfolio, NFTs, activity, send
    bridge/            # Cross-chain bridging (Skip.go integration)
    autosign/          # Auto-sign wallet derivation
    deposit/           # L1 <-> L2 transfers (includes Withdraw.tsx)
    tx/                # Transaction signing modal
    connect/           # Wallet connection
    receive/           # Receive address QR
    settings/          # Preferences, auto-sign settings
  lib/                 # Utilities and custom MemoryRouter
    router/            # In-widget navigation (no URL mutation)
  hooks/               # Shared utility hooks
  styles/              # Global CSS (reset, tokens, base)
examples/vite/         # Demo app for development
```

## Commands

```bash
pnpm dev           # Dev server with HMR (example app)
pnpm watch         # Dev with built package (no HMR)
pnpm build         # Library build (ES + CJS)
pnpm typecheck     # TypeScript type checking
pnpm lint          # ESLint + Prettier
pnpm test          # Vitest
```

Package-level (from `packages/interwovenkit-react/`):

```bash
pnpm build:fast    # Fast build (skips rollup type bundling)
pnpm release       # standard-version bump + changelog
```

## Code Conventions

### Naming

| Pattern          | Convention                | Example                             |
| ---------------- | ------------------------- | ----------------------------------- |
| Components       | PascalCase                | `QuantityInput`, `AsyncBoundary`    |
| Hooks            | `use` prefix, camelCase   | `useTx()`, `useAssets()`            |
| Atoms            | camelCase + `Atom` suffix | `isDrawerOpenAtom`, `txStatusAtom`  |
| Constants        | UPPER_SNAKE_CASE          | `DEFAULT_GAS_ADJUSTMENT`, `MAINNET` |
| Types/Interfaces | PascalCase                | `TxParams`, `FormValues`, `Config`  |
| CSS classes      | kebab-case (CSS Modules)  | `.button`, `.full-width`            |
| Query keys       | factory function          | `queryKeys.gas()`                   |

### Import Order

1. External libraries (`react`, `@tanstack/react-query`, `bignumber.js`)
2. Internal `@/` alias imports (`@/data/`, `@/components/`, `@/lib/`)
3. Local relative imports (`./styles`, `./Component`)

### Component Patterns

- **Default export** for main component per file
- **Variants as static properties**: `Button.White`, `Button.Outline`, `Button.Small`
- **CSS Module** co-located with component (`Component.module.css`)
- **Props interface** defined as `interface Props`
- **Form components** use `useFormContext()` from React Hook Form

### Export Patterns

- `src/index.ts` re-exports primarily from `src/public/` (exception: `MoveError` from `src/data/errors`)
- Data hooks: named exports (`export function useX()`)
- Components: default exports (`export default Component`)
- Types: inline exports (`export interface X`)

## Architecture

### State Management

- **Jotai**: UI state (drawer/modal open, tx request handler, portfolio refresh triggers)
- **React Query**: Server state (chains, assets, balances, gas estimation) with query key factory
- **React Hook Form**: Form state with `FormProvider` + `useFormContext()`, `mode: "onChange"`
- **ConfigContext**: Theme, URLs, feature flags merged with defaults
- **localStorage**: Bridge form persistence, auto-sign wallet state

### Transaction Flow

1. Page creates `TxRequest` (messages, gas, fees)
2. Sets `txRequestHandlerAtom` with resolve/reject callbacks
3. Opens `/tx` route in drawer/modal
4. Signing component reads atom, handles sign + broadcast
5. Resolves with txHash or rejects with error

### Routing

Custom `MemoryRouter` — in-memory history stack, no browser URL mutation. Supports `go(-1)`, state on location objects, and reset navigation.

### Styling

CSS Modules with CSS custom properties. Shadow DOM compatible (`:host` selectors). Design tokens for colors (gray 0-9, status colors), layout (border-radius, spacing), and typography. Light/dark theme via `data-theme` attribute.

### Multi-Chain

- Initia L1 + Interwoven rollups (MiniMove, MiniEVM)
- Address format: bech32 (Move/Cosmos), hex (EVM)
- Utility: `InitiaAddress(address).hex` / `.bech32`
- Chain type detection via metadata: `is_l1`, `minitia.type`

## Testing

- **Framework**: Vitest 4 with `globals: true`
- **Location**: Co-located with source as `*.test.ts` across `data/`, `pages/`, `components/`, `lib/`
- **Scope**: ~24 test files covering errors, signing, tx, portfolio, staking, liquidity, SSE parsing, autosign, bridge formatting, wallet activity, NFT queries, address utilities
- **Mocking**: `vi.mock()` for modules, `vi.mocked()` for typed assertions
- **No component render tests** — tests cover pure logic and data functions only

Run: `pnpm test`

## Important Notes

- **Shadow DOM**: Widget renders into Shadow DOM; styles use `:host` selector; `injectStyles()` required
- **Auto-sign**: Opt-in feature deriving a deterministic wallet from seed phrase; falls back to manual signing on error
- **CosmJS patches**: `data/patches/` contains monkey patches for amino, pubkeys, signature, encoding, and accounts
- **Build output**: ES module (`.js`) + CommonJS (`.cjs`), CSS extracted as both `.css` file and string `.js` export, `*.d.ts` declarations bundled
- **Path alias**: `@/*` maps to `src/*`
- **Pre-commit**: lint-staged runs ESLint + Prettier on staged files via simple-git-hooks
- **Release**: standard-version for versioning and CHANGELOG generation
