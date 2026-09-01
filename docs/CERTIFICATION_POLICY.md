# Exact-SHA certification policy

The source SHA under review must equal the SHA tested by CI and CodeQL, inspected by independent review, certified by CertForge and the Certification Forge GitHub App, approved by Release Sentinel, signed by the Commander, merged, and deployed. Any later code or workflow change invalidates the certificate and requires a new exact-SHA run.

Local tests, successful service restarts, HTTP 200 responses, branch pushes, or draft PRs are evidence but are not certification. When a provider CAPTCHA or user OAuth consent remains, the certificate must state the limitation and remain unsigned/unreleased.
