# Primary Git and automation

Primary project: https://forgejo-iac.tailcc818c.ts.net/household/nest-ledger .
Forgejo origin is authoritative; existing GitHub is a one-way secondary copy.
Agents use branches and may merge after required checks without routine human review, as Michael authorized.
CI runs in the isolated household worker. Source migration does not grant generic production credentials.
Application/data deployment remains its fixed, tested project capability.
Keep secrets, live databases, media and private profile state outside Git.
