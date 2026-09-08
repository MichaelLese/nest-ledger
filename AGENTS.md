# Family Finance Dashboard

Self-hosted household finance system for a two-spouse homelab (Proxmox LXC + Docker Compose).

Build principle: **Actual Budget is the financial ledger.** The custom app only adds household
ownership, responsibility, reconciliation, and simplified visualization.

## References
- `docs/doc_bd8b06650f63_family_finance_dashboard_proxmox_build_plan.pdf` — authoritative build plan (16 sections):
  architecture (SimpleFIN → Actual Budget → custom app → PostgreSQL), LXC sizing
  (2 vCPU / 2 GB RAM / 24-32 GB disk, Debian 13 unprivileged + nesting), data model
  (household_members, transaction_metadata, bills, split_rules, household_settings),
  bills manager, dashboard UX, joint reconciliation math, review queue, auth, security,
  backup policy, tech stack, and 8 implementation phases.

## Core design rules
- One shared household Actual budget; account ownership ≠ transaction ownership.
- Track "who owns the expense" (ME / WIFE / JOINT) separately from "who paid it".
- Use Actual categories for *what* the money was for; custom metadata for *who it belongs to / who paid*.
- Never infer expense ownership solely from the paying bank account.
- Extend Actual Schedules for bills; never build a second recurrence engine.
- Use Actual split transactions wherever possible so card transactions remain intact.
- Never rebuild Actual Budget in the custom app; never store a second financial ledger.
- Global UI filter is always: **ALL | ME | WIFE | JOINT**.
- One straightforward stack (Next.js + TypeScript + Tailwind frontend, Node + TypeScript backend,
  @actual-app/api, PostgreSQL, Docker Compose). Avoid microservices.

## Agent handoff contract
- CUSTOM APP MUST ANSWER: Who owns it? Who paid it? Is it joint? How should it be split?
  Who is responsible for the bill? Are we balanced? What is due next?
- No secrets in Git; PostgreSQL not externally reachable; HTTPS-only; Tailscale/WireGuard remote access.
