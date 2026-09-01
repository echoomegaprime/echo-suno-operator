# QUENCH/HAMMER no-popup policy

Echo automation on QUENCH must never create a visible terminal, browser, login, installer, credential, or error window. This includes diagnostics, OAuth repair, CAPTCHA handling, service recovery, tests, and scheduled work. A human-only OAuth or CAPTCHA gate is returned to the Commander as a pending action; automation must not open the provider page. PowerShell launchers use `-NoProfile -NonInteractive -WindowStyle Hidden`; `Start-Process` uses `-WindowStyle Hidden`; child-process tests use `windowsHide: true`; browser diagnostics use headless mode and a disposable profile.

Acceptance is measured, not inferred: the owning process must run in session 0 with `MainWindowHandle` equal to zero. Capture process ancestry and start time before attributing a user-session window to the repair. Do not kill unrelated interactive applications merely because they appeared during the same period.
