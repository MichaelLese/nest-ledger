# Checked production delivery

Forgejo main is authoritative. The fixed operator-owned guest publisher requires
the exact passing Project / Checks (push) status and rehearses releases using
authenticated encrypted checkpoints and private database clones. CI has no
production secrets. Passing PRs may merge without routine human review.

Only deployment/release.json selects allowlisted digest-pinned application images.
No floating tags, caller-supplied commands, mounts or host targets are accepted.
No schema/dependency/secret/configuration upgrade is silently accepted: changed
contracts or protected database contents block deployment and require operator
acceptance. The previous release and two encrypted cutover checkpoints are retained.
A committed release never rolls old data over subsequent edits.

Nest Ledger application source builds offline from its accepted dependency runtime. Actual
keeps its existing version unless a new digest passes the same finance clone and
rollback checks. Bank sync is never invoked in rehearsal.

See household/homelab-infrastructure: docs/services/FINANCE-MANGA-CD.md.
