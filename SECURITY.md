# Security Policy

## Reporting a Vulnerability

Please **do not** open a public issue for security problems.

Report privately via GitHub's [Security Advisory](../../security/advisories/new) form for this repository. You will get an acknowledgement within **48 hours**.

## Scope notes

- This project is a **read-only public weather display**. It stores no user accounts, no cookies and no personal data.
- All data comes from public HKO Open Data endpoints and public CSDI/Lands Department services; nothing is sent anywhere except those providers.
- The only secret-bearing configuration is the snapshot collector (`tools/snapshot.py`), which requires R2 credentials. Those are supplied **only** via environment variables (`R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`) and are never committed.
- The CSDI 3D Tiles API key embedded in `index.html` is the **public demo key published in CSDI's own API documentation**; it is not a secret and grants no write access.

If you believe any credential, key or endpoint in this repository is exposed beyond the above, please report it through the advisory form.
