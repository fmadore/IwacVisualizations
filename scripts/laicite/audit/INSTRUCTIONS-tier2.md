# Tier 2 — dossier membership audit

You are auditing one batch file of records that were selected into the IWAC
laïcité dossier (francophone West African press, Islamic periodicals,
archival documents, YouTube transcripts and scholarship, 1960s–2020s).

A record joins the dossier by one of two routes:

- it carries the curated Omeka subject tag **Laïcité** (`tagged_laicite`), or
- its title or full text matches the core vocabulary (`core_hits` > 0):
  laïcité, laïcisation, laïcisme, laïc/laïque (only when the surrounding words
  point to the secular-state sense, not the Catholic laity), État laïque,
  république laïque, sécularisme, sécularisation, séculier, secularism.

Each row has metadata, `ai_description` (an AI-written summary — context only,
never evidence), `core_windows` (up to six passages of about 400 characters
each side around a core hit, match wrapped in «»), and for tag-only records
without a hit, `opening` (the first 1,500 characters of the text).
`laity_demoted` counts occurrences the generator already discarded as the
laity sense; `unresolved_hits` counts ties it dropped. Text is OCR: expect
noise. A periodical issue is a whole magazine, so one relevant passage makes
the issue a legitimate member.

For every record decide:

1. `relevant` — `"yes"` if the record contains at least one passage that
   substantively concerns laïcité, the secular state, secularism, or the
   religion–state relationship (a claim, a debate, a policy, a dispute, a
   reflection — including a passing but genuine invocation of "l'État laïc"
   as a political principle). `"no"` if every window is a false sense (the
   Catholic laity, a "conseil laïc", an OCR artefact, a proper name) or an
   incidental word with no religion–state content. `"unassessable"` only
   when there is no usable text at all.
2. `laicite_sense` — what the core hits actually mean here: `"state"`
   (secular state / principle), `"laity"` (lay Catholics, lay person),
   `"mixed"`, or `"none"` (no core hit shown, tag-only).

Write a verdict file at the path given to you: a JSON array with one object
per input record, same order, shaped exactly:

```json
{"id": "6765", "subset": "articles", "run": "20261005T101500Z-a1b2c3",
 "relevant": "yes", "laicite_sense": "state", "note": ""}
```

Copy `run` from the input record **exactly**: a verdict whose `run` differs
from the batch's is rejected. `relevant` must be one of the three strings
above and `laicite_sense` one of the four. Keep notes short and only where
the verdict needs justification (English or French). Do not skip records. Do not read anything outside the batch file.
Do not modify the batch file. When finished, reply with one line: counts of
records, `relevant=no`, `relevant=unassessable`, `laicite_sense=laity`, and
the two or three clearest false members with title and id.
