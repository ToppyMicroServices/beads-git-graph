# Security Policy

This document describes how to report security issues and what to expect.

## Supported Versions

We support security fixes for:

- `main` branch (latest code)
- The latest release published to the VS Code Marketplace (if applicable)

Older releases may not receive fixes.

## Reporting a Vulnerability

Please **do not** open a public GitHub issue for security vulnerabilities.

Use GitHub’s private reporting feature:

1. Go to the repository **Security** tab
2. Click **Report a vulnerability**
3. Provide:
   - affected version/commit
   - reproduction steps
   - expected impact (what an attacker can do)
   - any proof-of-concept (PoC), if available

We aim to acknowledge receipt within **7 days**.

## Disclosure Policy

We follow **coordinated disclosure**.

- We will work with the reporter on a reasonable timeline for a fix and public disclosure.
- Typical target is **up to 90 days**, depending on severity and fix availability.

## Fix Priority

We prioritize issues that could lead to:

- Remote code execution (RCE)
- Credential/token leakage
- Arbitrary file read/write
- Supply-chain compromise (malicious dependency or CI/CD abuse)

Lower-severity issues may be addressed opportunistically.

## Security Review Scope and Responsibility

This project is maintained with security review in mind, including use in enterprise environments.
However, it is provided on an as-is basis under the project license, and the maintainers cannot accept responsibility for operational incidents, damages, losses, or compliance outcomes arising from its use.

Organizations adopting this extension are responsible for their own evaluation, testing, deployment controls, and incident response processes before production use.

Any supplemental Japanese-language notes are included because Japanese is the maintainer's native language.
They do not imply Japan-specific support, preferential treatment, or a different security posture for any particular region or user group.

## Security Best Practices for Contributors

- Avoid adding new dependencies unless necessary.
- Keep lockfiles up to date.
- Prefer pinned GitHub Actions versions (major tags or commit SHAs where practical).
- Do not commit secrets; use GitHub Actions secrets instead.
