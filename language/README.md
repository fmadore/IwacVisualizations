# Translations

Gettext catalog for strings rendered server-side by PHP (block labels,
form hints, loading messages, etc.). Client-side JavaScript strings
live in `asset/js/iwac-i18n.js`.

## Files

- `template.pot` — Source template. Regenerate from PHP/phtml sources when
  adding new `$this->translate()` calls.
- `fr.po` — French translation (human-editable).
- `fr.mo` — Compiled binary that Omeka actually loads at runtime.
  **Not committed** — generated from `fr.po`.

## Workflow

```bash
# Compile .po → .mo (required; Omeka loads the .mo, not the .po)
msgfmt language/fr.po -o language/fr.mo

# Update template from sources (requires xgettext)
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
