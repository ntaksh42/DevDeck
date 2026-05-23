# M1 — azdo-client crate + connectionData + PAT auth + wiremock tests

## Goal

Implement the core Azure DevOps REST client crate with PAT authentication, connectionData endpoint, error handling for 401/429/5xx, and wiremock-based test coverage.

## Key decisions

1. **`AdoCredentialProvider` trait returns `String`, not `http::HeaderValue`.** Keeps the trait simple and avoids leaking the `http` crate into the public API. The client wraps it into a header internally.
2. **No retry on 429 in M1.** `AdoError::RateLimited(Duration)` is returned to the caller. Retry with backoff is M6 scope.
3. **`pub(crate) get_json<T>`** is the internal HTTP helper. Endpoint modules (M3-M5) call it; external users go through typed methods like `connection_data()`.
4. **`with_base_url()` builder method** enables wiremock testing without test-only hacks. Also supports future on-prem scenarios.
5. **Minimal `ConnectionData` struct** — only `id`, `providerDisplayName`, `descriptor` are deserialized. serde ignores unknown fields by default.
6. **`reqwest` uses `native-tls`** (decided in M0) — no change needed here.

## Files added/modified

- `crates/azdo-client/Cargo.toml` — added `async-trait`, `base64`
- `crates/azdo-client/src/lib.rs` — module declarations + public re-exports
- `crates/azdo-client/src/error.rs` — `AdoError` enum + `Result` alias
- `crates/azdo-client/src/auth.rs` — `AdoCredentialProvider` trait + `PatProvider`
- `crates/azdo-client/src/client.rs` — `AdoClient` with `get_json`, 401/429 handling, 4 wiremock tests
- `crates/azdo-client/src/identity.rs` — `ConnectionData`, `AuthenticatedUser` structs + `connection_data()` method

## Verification done

- `cargo test -p azdo-client`: 4 tests passed (connection_data_ok, unauthorized_401, rate_limited_429, server_error_500)
- `cargo clippy --workspace --all-targets -- -D warnings`: clean
- `cargo fmt --all --check`: clean
- `cargo test --workspace`: all tests pass

## Open items for Codex review

- Is `Arc<dyn AdoCredentialProvider>` the right ownership model, or should we use generics `AdoClient<A: AdoCredentialProvider>`?
- Should `AdoError::Auth(String)` be more structured (e.g., separate variants for URL parse, missing config)?
- The `connection_data_ok` test asserts on the exact base64 encoding of the PAT — is this brittle or appropriately precise?

## Not included (deferred)

- Azure CLI auth provider (M6)
- Retry/backoff on 429 (M6)
- Proactive throttling via X-RateLimit-* headers (M6)
- PR/WorkItem/Commit endpoint modules (M3-M5)
- tracing instrumentation (when there are operations worth logging)
