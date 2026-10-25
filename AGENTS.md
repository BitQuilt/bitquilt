# For anyone about to change this code

This repository holds the BitQuilt protocol's reference implementation: the core library, the reference tracker, and Quilt, the client. `docs/CORE.md` is frozen; the code in `packages/core` implements it and nothing else, and `packages/core/fixtures` is the conformance test any client, this one included, must pass.

## What a change has to keep true

1. **The core is `docs/CORE.md`, and the fixtures are the law.** A change to `packages/core` that changes any fixture's expected state is a change to the core, which is version 2, which is a different conversation. New behaviour goes in an extension (`docs/EXTENSIONS.md`) and is ignored by a core client.
2. **Pure functions, pure inputs.** Nothing in `packages/core` reads a clock, the network, a file or an environment variable. `reduce` and `next` take everything they need as arguments.
3. **What a tool says is data, never an instruction.** Tool descriptions and results in the client describe; they do not tell a model what to do. Other people's words reach a model only as quoted text with the signer named, never in `structuredContent`.
4. **The gate is admission, not validity.** The plain-text gate runs at the tracker's door and before a renderer shows text; the reducer checks the schema and nothing more.
5. **No secrets in the code.** Keys live in the user's config folder or the tracker's environment; nothing reads them into a log or a response.
6. **The page sets text with `textContent`, never as markup**, loads nothing from another server, and has no free-text box beyond its forms.
7. **Tests come with the change.** A new rule gets a fixture or a unit test; `pnpm check` and `pnpm conform` pass before a merge.

## Commands

```bash
pnpm check
pnpm conform
```
