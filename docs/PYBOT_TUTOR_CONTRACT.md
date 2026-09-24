# PyBot Virtual Tutor — Future Contract (Foundation)

Status: **documented only** — Material V2 prepares the content model. This document does **not** implement the tutor, connect an AI provider, or add API keys.

## Product invariant

- The tutor exists to **help the student study**.
- It must **never** solve an exercise, task, quiz, test, or project for the student.
- For evaluative/practice items it should use **scaffolding**: questions, concept explanations, hints, debugging guidance, analogous examples, and progressive support.
- It must **not** output the final answer, completed solution, answer key, or finished code that directly satisfies the student's assigned work.
- Quiz/test contexts should be treated **even more restrictively**.
- The future API key / provider credentials must be **server-side only**; never expose them in browser code.

## Material context the tutor will consume later

- Material identity + provenance (`copied_from_content_id`, `original_content_id`, `original_owner_id`, `owner_id`)
- `language_code`, recommended age range, `difficulty`, `estimated_minutes`
- `subject` / tags, `learning_objectives`, `prerequisites`
- Current unit/item, `unit_type`, `item_type`
- Current material text / BlockNote `document_json`
- Exercise/task `starterCode` when relevant

## Code pointer

See `src/platform/pybotTutorContract.js` (`PYBOT_TUTOR_CONTRACT`, `buildTutorContextSkeleton`).
