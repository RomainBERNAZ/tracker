# src/frontend — React UI

React + TypeScript + Vite frontend for Expresso Review App.

## Structure

```
src/frontend/
├── src/
│   ├── components/          # React components
│   │   ├── Import.tsx
│   │   ├── Sessions.tsx
│   │   ├── HandList.tsx
│   │   └── HandDetail.tsx
│   ├── hooks/               # Custom React hooks
│   │   ├── useImportHH.ts
│   │   ├── useSessions.ts
│   │   └── useHandDetail.ts
│   ├── stores/              # Zustand stores
│   │   ├── appStore.ts
│   │   └── importStore.ts
│   ├── types/               # TypeScript types
│   │   └── index.ts
│   ├── App.tsx
│   └── main.tsx
├── index.html
├── vite.config.ts
├── tsconfig.json
├── package.json
└── pnpm-lock.yaml
```

## Commands

```bash
# Install dependencies
pnpm install

# Development (HMR, hot reload)
pnpm dev

# Build for production
pnpm build

# Tests
pnpm test

# Linting & formatting
pnpm lint
pnpm format
```

## API Contract (IPC)

Commands available via Tauri IPC:

- `import_hand_history(file_path, config)` → `ImportResult`
- `get_sessions()` → `SessionSummary[]`
- `get_hands_by_session(session_id)` → `HandSummary[]`
- `get_hand_detail(hand_id)` → `HandDetail`

See [UI_SPEC.md](../../docs/design/UI_SPEC.md) for screen designs.

## State Management

- **Zustand**: App state (current view, selected session)
- **TanStack Query**: Async data fetching & caching
- **React Context**: Theme (future)

## Accessibility

- WCAG AA contrast (4.5:1 min)
- Keyboard navigation (Tab, Enter, Esc, Arrows)
- Screen reader labels (aria-label)

See [UI_SPEC.md](../../docs/design/UI_SPEC.md) for full spec.
