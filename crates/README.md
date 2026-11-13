# Rust crates

Every Rust crate lives in `crates/<name>/` and is picked up by the root `Cargo.toml` workspace (`members = ["crates/*"]`). The toolchain is pinned in `rust-toolchain.toml`.

```bash
cargo build --workspace
cargo test --workspace
cargo fmt --check
cargo clippy --workspace -- -D warnings
```

Dev builds use `opt-level = 1` for workspace crates and `3` for dependencies. On Linux the linker is `lld` via `clang`: install both (`apt install clang lld`).

Bevy crates should enable Bevy's `dynamic_linking` feature for local dev builds only (`cargo run --features bevy/dynamic_linking`); release and CI builds must link statically.

The wire protocol is exported from the zod schemas to `schemas/protocol.schema.json` (`pnpm --filter @officexr/realtime-server gen:protocol-schema`); Rust protocol types are meant to be generated from that file rather than hand-written.
