# Security policy

## Supported versions

Security fixes are made on the current `1.x` release line. The module declares
Omeka S `^4.0.0`; CI boots it on the literal floor (Omeka S 4.0.0 on PHP 8.1)
and on the production pair (Omeka S 4.2.1 on PHP 8.5). Upgrade an older
release before reporting against it.

## Reporting a vulnerability

Do not open a public issue for a suspected vulnerability. Use GitHub's
**Security → Report a vulnerability** flow for this repository so the
maintainer can investigate privately. Include the affected version,
reproduction steps, impact, and any proposed mitigation. Please avoid
accessing data that is not your own, and allow a reasonable remediation
window before disclosure.

## Security boundaries

- **The generated data is public.** The generators read the private full
  mirror of the dataset in CI and publish their JSON as GitHub release
  archives that anyone can download. Full text may appear in them only for
  records whose `OCR_is_public` flag is true; `scripts/validate_data.py`
  refuses an archive that quotes private text in the concordance or calendar
  outputs. Data that must stay private does not belong in a generator.
- **Pulling data is a global-admin action.** The *Pull latest data* job
  replaces `files/iwac-visualizations/` for every site on the installation.
  It verifies the checksum sidecar before downloading the archive, every
  file against the manifest's SHA-256, the archive's data contract, and every
  entry's path and attributes before extracting. It publishes an immutable
  generation and activates it in one step.
- **Markup built from data is escaped.** Titles, names and OCR text are
  archive content. `npm run lint:js` (eslint-plugin-no-unsanitized) rejects
  unescaped `innerHTML` and popup HTML, and `tests/js/formatter-sweep.test.js`
  drives every shared chart tooltip with a hostile label.
- **No inline script; pinned libraries.** Blocks hand the loader inert JSON,
  so a host with `script-src 'self'` breaks nothing. The CDN libraries are
  pinned by version and Subresource Integrity hash.
- **Embeds relax framing on their own routes only.** `/iwac-embed` responses
  replace `X-Frame-Options` with a permissive `frame-ancestors`, so the blocks
  can be framed elsewhere; every other page keeps the site's policy.
