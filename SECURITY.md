# Security Policy

This repository is maintained by ToppyMicroServices OÜ.

For the full coordinated disclosure policy, see:
[https://toppymicros.com/security-policy.html](https://toppymicros.com/security-policy.html)

Machine-readable policy:
[https://toppymicros.com/.well-known/security.txt](https://toppymicros.com/.well-known/security.txt)

## Scope

In scope:

- Public assets under `toppymicros.com`
- Public repositories maintained by ToppyMicroServices OÜ, including this repository

Out of scope (non-exhaustive):

- Best-practice suggestions without a demonstrable exploit path
- Self-XSS and browser or devtools-only issues
- Volumetric denial of service

## Extension Trust Boundary

- Git history and tracked Beads JSON/JSONL can be viewed in VS Code Restricted Mode.
- Starting `bd`, contacting an AI provider, managing provider credentials, creating worktrees, and
  changing Git or Beads state require a trusted workspace.
- The `bd` executable setting is machine-scoped. Every `bd` child process started by this extension
  receives `DOLT_DISABLE_EVENT_FLUSH=true`; manually invoked Beads processes are outside this
  guarantee.
- The extension does not initialize, bootstrap, migrate, or bypass the schema checks of a Beads
  database.

Beads task fields, Git metadata, provider responses, and imported Plan Drafts are untrusted input.
Generated model output is stored as plain text for review and is never automatically executed or
applied. The oldest response artifacts are removed after the configured retention count is
exceeded, and users can clear all retained artifacts from the Command Palette.

Provider credentials are stored in VS Code SecretStorage or read from documented environment
fallbacks. Do not put credentials or secrets in workspace settings, Beads records, prompts, plans,
or AI responses. Beads files may be tracked in Git and therefore may become public when committed
to a public repository.

Cloud AI providers and the separately installed Beads CLI have independent dependencies, network
behavior, and disclosure processes. Reports demonstrating that this extension exposes those
surfaces unsafely are in scope; an upstream advisory without an extension-specific exploit path
should also be reported upstream.

## Reporting a Vulnerability

Please report vulnerabilities to:
`security@toppymicros.com`

Use the subject line:
`[SECURITY] <short summary>`

This mailbox is used for coordinated vulnerability disclosure.
Please do not disclose vulnerabilities publicly before remediation is available.

Include:

- Affected asset and vulnerability summary
- Reproduction steps or proof of concept
- Impact assessment
- Optional remediation guidance

## Response Targets

- Acknowledgement target: within 5 business days
- Remediation target: generally 30 days; complex issues may require up to 60 days

## Safe Harbor

If you act in good faith and follow this policy, we will not pursue legal action for your research activities.
