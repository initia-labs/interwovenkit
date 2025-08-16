# InterwovenKit

See [README.md](packages/interwovenkit-react/README.md) for detailed package documentation.

## Table of Contents

- [Installation](#installation)
- [Configuration](#configuration)
- [Running Locally](#running-locally)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Scripts](#scripts)

## Installation

```bash
git clone https://github.com/initia-labs/interwovenkit.git
cd interwovenkit
pnpm i
pnpm build  # Build the package at least once before running in development mode
```

## Configuration

```bash
cd examples/vite
cp .env.development .env.development.local  # Toggle between mainnet and testnet in this file
```

```env
INITIA_NETWORK_TYPE=mainnet  # Network Configuration
```

## Running Locally

### Development Mode

Run the demo site directly from your local source with hot module replacement (HMR):

```bash
pnpm dev
```

- The package source files will be injected into the portal element in the document body.
- The demo site will be available at: [http://localhost:5173](http://localhost:5173)

### Production Mode

After making changes to the package, rebuild and run the demo using the compiled output:

```bash
pnpm build  # Rebuild the package after any changes.
pnpm watch  # Serve the demo using the built package and styles.
```

- In production mode, the package and its styles will be injected into a Shadow DOM.
- The demo site will be available at: [http://localhost:5173](http://localhost:5173)

## Tech Stack

### Core Framework

- [React 19](https://react.dev/)
- [Vite](https://vitejs.dev/)

### State Management

- [Jotai](https://jotai.org/)
- [TanStack Query](https://tanstack.com/query/)
- [React Hook Form](https://react-hook-form.com/)

### Blockchain Integration

- [CosmJS](https://cosmos.github.io/cosmjs/)
- [wagmi](https://wagmi.sh/)

### UI & Styling

- [CSS Modules](https://github.com/css-modules/css-modules)
- [React Spring](https://www.react-spring.dev/)
- [Radix UI](https://www.radix-ui.com/)

### Utilities

- [ky](https://github.com/sindresorhus/ky)
- [date-fns](https://date-fns.org/)
- [ramda](https://ramdajs.com/)
- [BigNumber.js](https://mikemcl.github.io/bignumber.js/)

## Project Structure

```
packages/interwovenkit-react/src/
├── public/          # Public API exports
├── lib/             # Utilities and router
├── data/            # Core blockchain logic
├── hooks/           # Custom React hooks
├── components/      # Reusable UI components
├── pages/           # UI pages
└── styles/          # Global styles
```

### Core Components

- `<InterwovenKitProvider />`: The main provider component that wraps your application and provides all necessary contexts for wallet integration.
- `useInterwovenKit()`: Primary hook for accessing wallet and bridge functionality.

## Scripts

```bash
pnpm dev
pnpm build
pnpm typecheck
pnpm lint
pnpm test
```
