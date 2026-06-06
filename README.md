# Form Paglu

A Chrome extension built with React, TypeScript, Vite, and Turborepo.

## Tech Stack

- [React](https://reactjs.org/)
- [TypeScript](https://www.typescriptlang.org/)
- [Tailwind CSS](https://tailwindcss.com/)
- [Vite](https://vitejs.dev/)
- [Turborepo](https://turbo.build/repo)

## Structure

- `chrome-extension/` - Extension core (manifest, background service worker)
- `pages/popup/` - Popup UI shown when clicking the extension icon
- `pages/side-panel/` - Side panel UI (Chrome 114+)
- `packages/` - Shared packages (ui, storage, i18n, shared, etc.)

## Getting Started

### Prerequisites

- Node.js >= 22.15.1
- pnpm >= 10

### Installation

```bash
pnpm install
```

### Development

```bash
pnpm dev
```

### Production Build

```bash
pnpm build
```

### Load Extension in Chrome

1. Run `pnpm dev` or `pnpm build`
2. Open `chrome://extensions`
3. Enable **Developer mode**
4. Click **Load unpacked**
5. Select the `dist` directory

## Scripts

| Command | Description |
|---------|-------------|
| `pnpm dev` | Start development with HMR |
| `pnpm build` | Production build |
| `pnpm zip` | Build and zip for distribution |
| `pnpm lint` | Run ESLint |
| `pnpm type-check` | Run TypeScript type checking |

## Install Dependencies

```bash
# Root dependency
pnpm i <package> -w

# For a specific module
pnpm i <package> -F <module-name>
```
