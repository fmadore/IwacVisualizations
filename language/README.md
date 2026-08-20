# Translations

Gettext catalog for strings rendered server-side by PHP (block labels,
form hints, loading messages, etc.). Client-side JavaScript strings
live in `asset/js/iwac-i18n.js`.

## Files

- `template.pot` — Source template. Regenerate from PHP/phtml sources when
  adding new `$this->translate()` calls.
- `fr.po` — French translation (human-editable). **Edit this one.**
- `fr.mo` — Compiled binary that Omeka actually loads at runtime.
  **Committed, and must be recompiled with every `fr.po` edit.**

`fr.mo` is committed because the release archive is built with `git archive`
(see `.github/workflows/release.yml`), so a file generated at package time
would never reach the zip — the module would ship with no French at all.

## Workflow

```bash
# 1. Edit fr.po.
# 2. Recompile — Omeka loads the .mo and never reads the .po.
npm run build:mo
# 3. Commit both files together.
```

`npm run lint` fails if the two disagree (`scripts/check-i18n-mo.js`). That
guard exists because they did: three msgids were reworded in `fr.po` before
v1.49.0 and the `.mo` was never recompiled, so the admin UI carried French
keyed to msgids the English source no longer contained. Each one fell through
to English with no error anywhere — the only symptom was an untranslated
block description.

The comparison is over the parsed catalogues rather than the bytes, so a
`.mo` produced by GNU `msgfmt` elsewhere passes just as well as one from
`npm run build:mo`.

## No gettext on this machine

`msgfmt` and `xgettext` are not installed, which is why `scripts/build-mo.js`
carries its own po→mo compiler (`scripts/gettext.js`, Node built-ins only).
Where a real toolchain is available the equivalents are:

```bash
# Compile fr.po → fr.mo (what npm run build:mo does)
msgfmt language/fr.po -o language/fr.mo

# Update the template from sources
xgettext \
  --from-code=UTF-8 \
  --language=PHP \
  --keyword=translate \
  --output=language/template.pot \
  $(find . -name "*.php" -o -name "*.phtml")

# Merge template changes into existing fr.po
msgmerge --update language/fr.po language/template.pot
```

`gettext` tools on Debian/Ubuntu: `sudo apt install gettext`.

The bundled compiler handles what this catalogue uses — contexts, plurals,
fuzzy and obsolete entries — but rejects octal (`\123`) and hex (`\xNN`)
string escapes rather than guessing at their bytes. Nothing here uses them;
add support to `scripts/gettext.js` if that changes.
