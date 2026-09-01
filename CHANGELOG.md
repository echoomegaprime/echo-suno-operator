# Changelog

## Unreleased

- Updated the Suno Studio host and current web generation contract, including dynamic billing plan/model resolution and current Clerk token metadata.
- Added fail-closed billing and CAPTCHA preflight behavior with structured provider error classifications.
- Preserved `CAPTCHA_REQUIRED` through the MCP transport without converting it to a generic connector failure.
- Added a shared-credential boundary between the OAuth connector and privileged HTTP MCP backend.
- Protected private REST status, voice, job, and library endpoints with the studio token.
- Standardized the Windows scheduled-task launcher on a hidden, working-directory-relative process.
- Added provider-contract, MCP-error, proxy-auth, HTTP-security, public-route ownership, and no-popup regression coverage.
- Corrected the authoritative tunnel path to a leading-slash Go regular expression and documented exact public-boundary and rollback verification.
- Made human-only OAuth and CAPTCHA gates report-only on QUENCH so automation never opens an interactive window.
