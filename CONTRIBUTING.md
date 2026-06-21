# Contributing Guide

## Code of Conduct

Be respectful, professional, and collaborative.

---

## Development Workflow

1. **Create a branch**: `git checkout -b feature/XXX` or `fix/XXX`
2. **Make changes**: Follow code style (clippy, ESLint, Prettier)
3. **Test locally**: `cargo test`, `pnpm test`
4. **Pre-commit**: Hooks run automatically (lint, format)
5. **Push & PR**: Include description and link related issues

---

## Code Style

### Rust
- Run `cargo fmt` before commit
- Zero clippy warnings: `cargo clippy -- -D warnings`
- Comments: `///` for public docs, `//` for inline

### TypeScript/React
- Run `pnpm format` before commit
- ESLint must pass: `pnpm lint`
- Use TypeScript strict mode; avoid `any`

### Commits
- Use conventional commits: `feat:`, `fix:`, `docs:`, `test:`
- Example: `feat: add side pot calculation for 3-way all-in`

---

## Documentation

- Update [ARCHITECTURE.md](./docs/design/ARCHITECTURE.md) for major changes
- Add ADR if decision impacts design (see [adr/](./docs/adr/))
- Update relevant markdown files in [docs/](./docs/)

---

## Testing

- Add tests for new features
- Run full suite before PR: `cargo test --all`, `pnpm test`
- Golden dataset must pass: `cargo test golden -- --ignored`

---

## Performance

- Profile before & after optimization
- Don't sacrifice readability for minor gains (<5%)
- Document trade-offs in code comments

---

## Reporting Issues

- Use GitHub Issues
- Include: reproduction steps, expected vs actual, environment
- Label: bug, enhancement, documentation, question

---

**Questions?** Open an issue or reach out to the maintainers.
