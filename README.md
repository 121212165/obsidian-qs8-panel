# QS-8 Score Panel

An Obsidian scoring panel for serialized web-fiction chapters, implementing the
QS-8 eight-dimension weighted system (total 0–10):

| Dim | Weight | Measured |
|---|---|---|
| D1 Opening hook | 15% | manual slider |
| D2 Ending hook | 15% | manual slider |
| D3 Conflict & tension | 20% | manual slider |
| D4 Rhythm shape | 10% | **auto** — sentence-length CV + short-sentence share |
| D5 Specificity | 15% | **auto** — object-word & sense-word density, told-emotion penalty |
| D6 Dialogue voice | 10% | **auto** — tag diversity, dialogue density, avg length |
| D7 Info density | 5% | manual slider |
| D8 Logic & motivation | 10% | manual slider |

Verdict bands: ≥8 publish · ≥7 minor revision · ≥5.5 major revision · below =
rework (<7 does not enter the canon draft folder).

## Usage

1. Open a chapter note, click the ribbon gauge icon (or run the command).
2. Script-measured D4/D5/D6 are computed instantly with metric details; adjust
   them in "修正脚本项打分" if you disagree.
3. Rate the five judgment dimensions on sliders (each hover shows its
   definition; sliders follow the anchor-point rubric).
4. The weighted total and verdict update live. Click 记入台账 to append a row
   to your score ledger (`QS8记分.md` by default) — accumulate rows and you
   can later regress which dimensions actually drive retention.

## Notes

- All word lists and weights are editable constants at the top of `main.js`.
- Plain JavaScript, no build step; runs entirely offline.
