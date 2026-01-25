# InterwovenKit

React library for wallet and bridge integration on Initia blockchain.

## Important

**Always use pnpm** - never npm, yarn, or bun.

## Quick Reference

| Command          | Purpose                                  |
| ---------------- | ---------------------------------------- |
| `pnpm dev`       | Run demo site with HMR at localhost:5173 |
| `pnpm build`     | Build the package                        |
| `pnpm typecheck` | Run TypeScript type checking             |
| `pnpm lint`      | Run ESLint                               |
| `pnpm test`      | Run tests                                |

## Project Structure

- `packages/interwovenkit-react/` - Main library package
- `examples/vite/` - Demo application

## Code Style

- TypeScript (extends `@tsconfig/vite-react`)
- CSS Modules for styling (`.module.css` files)
- Pre-commit hooks run ESLint + Prettier automatically

## Key Patterns

- State: Jotai atoms + TanStack Query for async data
- Forms: React Hook Form
- UI: Base UI + Radix UI primitives, React Spring for animations
- Blockchain: CosmJS (Cosmos) + wagmi/RainbowKit (EVM)

## Testing

Run `pnpm test` before committing. Tests use Vitest and are colocated with source files (`.test.ts`).
