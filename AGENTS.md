# AGENTS.md

## Project

Ganymede is a local-first desktop app where artists search, curate and explore visual references (Bing Images,
ranked locally with CLIP; a live similarity map per project). Tauri 2 + Rust, React 19 + TypeScript, Tailwind 4, Vite, Vitest.

## Commands

```bash
bun install
bun run model        # downloads CLIP + ONNX Runtime into src-tauri/models/ (needed for edges and visual ranking)
bun run tauri dev    # desktop app (Vite on :1421)
bun run dev          # frontend only, in the browser (Bing through the Vite proxy, no CLIP, no persistence)
bun run lint         # eslint + knip (dead files, exports, dependencies)
bun run typecheck    # tsc --noEmit
bun run test         # vitest (not `bun test`, a different runner)
bun run format       # prettier + cargo fmt
bun run build        # frontend bundle; `bun run tauri build` makes installers
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml      # `-- --ignored` hits real Bing and runs real CLIP
bun run seed -- --reset   # demo space from real searches into the app data dir (app closed)
bun run jitter            # fails if the map jitters at rest (reads a space from the database)
```

## Philosophy

Load `/ponytail` before writing code and run `/ponytail-review` before calling work done. For every piece of code,
stop at the first answer that holds:

1. Does it need to exist? If not, delete it.
2. Does the standard library (TS or Rust) do it?
3. Does the platform do it (HTML/CSS, browser APIs, official Tauri plugins)?
4. Does an installed dependency do it?
5. Does it fit in one line?
6. Only then write the minimum that works.

Never cut: input validation at the Tauri boundary, error handling that prevents data loss, security, accessibility.
The deciding question for features: does it make reference discovery faster, better or smoother for the artist?

## Structure

```
src/
  main.tsx App.tsx         App is the composition root: layout, window-level input, toast and confirmations
  state.ts types.ts        the single reducer (immutable library) and the domain types
  styles/index.css         design tokens (@theme), keyframes, CSS Tailwind cannot express
  components/              UI used by two or more features
  lib/                     shared logic; api.ts is the only file that talks to Tauri
  features/<feature>/      one folder per area: board, graph, library, preview, search, shell
    search/pipeline/       query parsing, Bing client, ranking (pure, tested)
  dev/                     measurement only (F9 frame HUD, synthetic bench space)
src-tauri/src/
  lib.rs                   Builder: plugins, state, media: protocol, invoke_handler
  error.rs                 the one Error type (thiserror, serializes as its message)
  commands/                thin #[tauri::command]s, one file per domain
  bing.rs vision.rs store.rs graph.rs   domain logic, testable without Tauri
scripts/                   model download, demo seed, jitter check
```

- Code used by one feature lives in that feature. Move it to `components/` or `lib/` only when a second feature imports it.
- Feature folders stay flat; add a subfolder only for a distinct layer (like `search/pipeline/`).
- A Rust command validates its arguments, calls one domain function and returns `Result<T, Error>`. Logic and SQL live in the domain module.

## Code rules

React and TypeScript

- One global state: `useReducer` in `App` with `state.ts`. Local state stays local. Derive values instead of storing them.
- `useEffect` only syncs with something outside React. Event-like logic inside an effect goes through `useEffectEvent`.
- `useMemo`/`useCallback`/`memo` only for a measured gain or an identity another hook depends on.
- `strict` TypeScript. No `any`, no `@ts-ignore`, no `as` to silence an error; narrow instead.
- Components never call `invoke` or know command names: add a typed function to `lib/api.ts`.
- No barrel files. Components `PascalCase.tsx`, hooks `useThing.ts`, other files `camelCase.ts`.
- The reducer is immutable: unchanged objects keep their identity, because `lib/store.ts` writes the diff by identity.
- A detached pane is another window running `App` in solo mode (`?pane=`). The main window alone persists, searches
  and reads palettes; every action is broadcast through `lib/windows.ts` and replayed in the other windows, so the
  reducer stays deterministic: ids, times and random values arrive inside the action.
- A drag that can leave its pane uses native drag and drop (`lib/drag.ts`), the only thing that crosses windows (Wayland
  hides window positions). Pan, marquee, resize and links stay pointer gestures.

Styling and motion

- Tokens live once in `src/styles/index.css` (`:root`, `[data-theme="dark"]`, `@theme inline`). Use Tailwind utilities; custom CSS only for what utilities cannot express.
- Animations and transitions are part of the product: keep easing, durations and fluidity identical when refactoring. Everything respects `prefers-reduced-motion`.
- Never give a persistent element a fixed `view-transition-name`: WebKitGTK stops painting it. Set names through `data-*` attributes only during a transition (see `[data-morph]`, `[data-reflow]`).
- The map is one Canvas2D with the layout in a Worker that never stops (30 Hz idle, 60 Hz interacting, paused when hidden). Design for at most ~5k references per space.

Rust

- No `unwrap()`/`expect()` on runtime paths (startup is fine). Mutex guards recover from poisoning.
- No `unsafe`, no `#[allow(dead_code)]`, no needless `clone()`. `cargo fmt` and `clippy -D warnings` clean.
- Capabilities stay least-privilege (`src-tauri/capabilities/default.json`); add a permission only with the feature that needs it.

Bing

- Only ever the results page (`/images/async`), only on a user action, at human volume. Never rotate IPs or user agents, never solve CAPTCHAs, never work around a block.

Comments and language

- No comments that say what the code does. Keep only short "why" comments the code cannot express (platform workarounds, non-obvious performance choices, `// SAFETY:`).
- Code, names, comments, commits, docs and UI text in English.

## Recipes

Add a frontend feature

1. Create `src/features/<name>/` with the components and their pure logic; add actions to `state.ts` only if the state is global.
2. Put a `*.test.ts` next to non-trivial logic (see `features/search/pageGrid.test.ts`).
3. Wire it in `App.tsx`. Promote code to `components/`/`lib/` only when a second feature needs it.

Add a Tauri command

1. Domain: a function or method in `src-tauri/src/<domain>.rs` returning `crate::error::Result<T>`, with a unit test.
2. Command: a thin function in `src-tauri/src/commands/<domain>.rs` that validates input (see `commands/vision.rs`).
3. Register it in `generate_handler!` in `src-tauri/src/lib.rs`.
4. Permissions: app commands need none; add plugin permissions to `capabilities/default.json` only if the feature uses a plugin.
5. Wrapper: a typed function in `src/lib/api.ts`; call that, never `invoke`.

Add a dependency

1. Justify it: check the standard library, the platform and the installed dependencies first.
2. Prefer a small, maintained package; pin exact versions for anything in the render or worker path.
3. `bun run lint` (knip) and `cargo machete` must stay clean.

## Definition of done

- `bun run lint`, `bun run typecheck`, `bun run test`, `bunx prettier --check .`, `cargo fmt --check`, `cargo clippy -D warnings` and `cargo test` pass.
- No dead code, unused exports or orphan files; a test for every new piece of risky logic.
- Animations, keyboard access and focus behave as before.
- One Conventional Commit per subject (`feat:`, `fix:`, `refactor:`, `chore:`, `docs:`, `test:`).

## Don't

- Narrating comments ("Now we…", "Updated to…"), commented-out code, old TODOs.
- Abstractions with one use: interfaces, factories, providers, config nobody sets.
- `any`, `as` casts to silence errors, `unwrap()` at runtime.
- `invoke` in a component, or Tauri command names outside `lib/api.ts`.
- Planning or spec files committed to the repository.
