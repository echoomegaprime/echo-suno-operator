# QUENCH/HAMMER no-popup policy

Production automation must not create a visible terminal, browser, login, installer, credential, or error window. PowerShell launchers use `-NoProfile -NonInteractive -WindowStyle Hidden`; `Start-Process` uses `-WindowStyle Hidden`; child-process tests use `windowsHide: true`; browser diagnostics use headless mode and a disposable profile.

Acceptance is measured, not inferred: the owning process must run in session 0 with `MainWindowHandle` equal to zero. Capture process ancestry and start time before attributing a user-session window to the repair. Do not kill unrelated interactive applications merely because they appeared during the same period.
