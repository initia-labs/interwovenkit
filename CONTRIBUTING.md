# Contributing to InterwovenKit

This file provides guidance to developers when working with code in this repository.

## Project Overview

InterwovenKit is a React SDK for Initia blockchain integration, providing wallet connection, bridge functionality, and transaction signing. It's built as a monorepo with pnpm workspaces.

## Setup

Clone the repository, install dependencies, and build the package:

```bash
git clone https://github.com/initia-labs/interwovenkit.git
cd interwovenkit
pnpm i
pnpm build  # Build the package at least once before running in development mode.
```

Next, switch to the Vite example folder and configure your environment:

```bash
cd examples/vite
cp .env.development .env.development.local  # Toggle between mainnet and testnet in this file.
```

## Development Mode

Run the demo site directly from your local source with hot module replacement (HMR):

```bash
pnpm dev
```

- The package source files will be injected into the portal element in the document body.
- The demo site will be available at: [http://localhost:5173](http://localhost:5173)

## Production Mode

After making changes to the package, rebuild and run the demo using the compiled output:

```bash
pnpm build  # Rebuild the package after any changes.
pnpm watch  # Serve the demo using the built package and styles.
```

- In production mode, the package and its styles will be injected into a Shadow DOM.
- The demo site will be available at: [http://localhost:5173](http://localhost:5173)

## Development Commands

### Quality Assurance

```bash
pnpm typecheck    # Run TypeScript checks across all packages
pnpm lint         # Run ESLint across all packages
pnpm test         # Run tests across all packages
```

## Architecture

### Monorepo Structure

- `packages/interwovenkit-react/` - Main React SDK package
- `examples/vite/` - Vite development example

### Core Package Architecture (`packages/interwovenkit-react/`)

**Entry Point**: `src/index.ts` - Exports public API including components, hooks, and utilities

**Key Directories**:

- `src/public/` - Public API surface (components, hooks)
- `src/data/` - Core blockchain integration logic (signers, transactions, chains)
- `src/pages/` - UI pages (bridge, wallet, tx signing)
- `src/components/` - Reusable UI components
- `src/lib/router/` - Custom routing implementation

**State Management**: Uses Jotai for state management with React Query for server state

**Styling**: CSS Modules

### Key Components

- `InterwovenKitProvider` - Main provider component
- `useInterwovenKit()` - Primary hook for wallet/bridge interactions
- Bridge system in `src/pages/bridge/` with Skip Protocol integration
- Transaction handling in `src/data/tx.ts` and `src/pages/tx/`

### Blockchain Integration

- Cosmos SDK integration via CosmJS
- Ethereum compatibility via ethers/viem
- Custom Initia protocol support
- Skip Protocol for cross-chain bridging

## Testing

- Unit tests use Vitest
- Run tests with `pnpm test` or `pnpm --filter interwovenkit-react test`
- Test files are co-located with source files (`.test.ts` suffix)
- Test configuration is in `packages/interwovenkit-react/vitest.config.ts`

## Build System

- Uses Vite for building the package
- ESM and CJS outputs generated
- CSS bundled into `styles.css` and also exported as JS string in `styles.js`
- Type definitions rolled up in production builds (skipped in fast mode)
- Path aliasing configured: `@/` maps to `src/`
