# Tier 1 — annotation-frame precision audit

You are auditing one batch file of keyword matches from the IWAC laïcité dossier
(francophone West African press, Islamic periodicals, archival documents and
scholarship, 1960s–2020s). The dossier itself is selected by the terms
*laïcité / laïc / laïque / État laïque / sécularisme…* (the "core" frame).
The matches you are judging are **annotation frames** counted inside dossier
records — they never select a record, they describe what the record talks
about near the laïcité vocabulary.

Each row in the batch has: `subset`, `id`, `title`, `year`, `outlet`, `frame`,
`form` (the matched surface string), `field` (title or OCR), `near_core_hit`
(within 80 tokens of a core laïcité hit — only these count in the arenas view),
and `window` (about 500 characters each side; the match is wrapped in «»).
Text is OCR: expect noise, broken accents, hyphenation.

The frames and their intended sense:

- `droit-famille` (law & family): family law and personal status — marriage
  regimes, polygamy, divorce as a marital matter, inheritance/succession of
  estates, civil registry, the family code. **Not** a political "divorce"
  between parties, a cultural or spiritual "héritage", "état civil" used as a
  mere document reference is borderline (mark `sense_ok` true but note it).
- `ecole` (schooling): confessional/Quranic/franco-arabe/public/laïque
  schooling and religious instruction as a matter of education policy.
- `espace-public` (public space & signs): veil, religious signs, dress,
  street prayer, call to prayer, minarets, loudspeakers, beards — as objects
  of public regulation or contestation.
- `etat-rites` (state & rites): state organisation of hajj/pilgrimage,
  public holidays, subsidies to religions, chaplaincies, official delegations,
  the head of state attending a rite.
- `liberte-religieuse`, `pluralisme`, `separation`: religious freedom,
  religious pluralism / living together, separation or neutrality of the
  state. Usually unambiguous; check the phrase is used in that sense.
- `concurrence` (radicalism vocabulary): intégrisme / islamisme /
  fondamentalisme. Sense is almost always fine; judge only `religion_state`.

For every row, decide two things:

1. `sense_ok` — does the matched form carry the frame's intended sense in this
   passage? (A political "divorce" → false. "Héritage culturel" → false.
   "Divorce" as the end of a marriage → true, even in a foreign-news story.)
2. `religion_state` — does the surrounding passage concern religion and the
   state / public order / law in any way (religious family law, a state
   regulating rites, a debate about confessional schooling, laïcité itself)?
   A passage about divorce with no religious or state dimension → false.

Write a verdict file at the path given to you. It is a JSON array with one
object per input row, **in the same order**, shaped exactly:

```json
{"id": "6925", "form": "divorce", "field": "OCR", "window_index": 0,
 "sense_ok": true, "religion_state": true, "note": ""}
```

`window_index` is the row's 0-based position in the batch file. Keep notes
short and only where the verdict is not obvious (in English or French).
Do not skip rows. Do not read anything outside the batch file. Do not modify
the batch file. When finished, reply with one line: counts of rows,
`sense_ok=false`, `religion_state=false`, and the two or three most striking
false positives with their form and id.
