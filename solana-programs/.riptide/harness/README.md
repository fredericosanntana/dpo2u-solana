# Riptide Rust Harness

This crate owns protocol-specific setup for the adapter:

`/root/dpo2u-solana/solana-programs/.riptide/adapters/knect-tokenomics.toml`

Use it when your program needs real account bytes, sibling programs, SPL mints,
token accounts, PDAs, or other setup that should not become Riptide core code.
The generated crate is intentionally empty until deterministic setup is added;
`/riptide-config` should complete this file when external accounts or concrete
bootstrap bytes are required.

Run it through the CLI:

```sh
riptide run --adapter /root/dpo2u-solana/solana-programs/.riptide/adapters/knect-tokenomics.toml --harness . --seeds 1 --seed-root 1337
```

After the one-seed smoke passes, drop `--seeds 1 --seed-root 1337` for the
full scenario sweep.
