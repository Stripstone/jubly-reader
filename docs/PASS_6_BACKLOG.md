# Jubly Reader — Pass 6 Backlog

_Status: working backlog for accountability_

## Pass 6 objective
Site-wide functionality cleanup focused on **Profile**, **Library**, **Text importer**, and **Help** surfaces, while preserving runtime ownership of reading, progress, session, and importer truth.

This backlog is intended to hold Pass 6 accountable to completion without allowing scope drift into auth, billing, entitlement, usage-policy, or provider-policy work.

---

## Governing pass rules

1. Keep Pass 6 bounded to site-wide cleanup only.
2. Keep reading, progress, session, and importer truth under the runtime owner, not shell.
3. Reuse the existing prefs-style persistence seam for Daily Goal and celebration memory.
4. Do **not** add a sidecar store such as `js/surface_data.js`.
5. Treat Profile, Library, Text importer, and Help as the primary user-facing surfaces in scope.
6. Preserve already-correct runtime behavior unless validation proves a mismatch.

---

## File scope

- `index.html`
- `js/import.js`
- `js/library.js`
- `js/state.js`
- `js/shell.js`
- `css/shell.css`
- `js/help.js` _(new, if needed)_

---

## Suggested implementation order

1. Reading metrics foundation
2. Library rows and preview summary
3. Profile goal and progress surfaces
4. Daily celebration behavior
5. Text importer completion
6. Help wiring
7. Subscription card wording cleanup
8. Runtime verification and polish

---

# Pass 6 backlog items

## 1. Library rows show real values instead of filler text
**Goal:** Replace fake status and fake time in Library rows with real values.

### Expected user-facing result
Each Library row should show truthful reading metadata instead of placeholder copy.

### Required behavior
- Replace filler **Status** with real reading status.
- Replace filler **Time** with real estimated reading time or remaining time.
- Values should reflect stored reading activity, not cosmetic placeholders.

### Acceptance notes
- A never-opened book should not pretend to be in progress.
- A completed book should not appear unread.
- The Library should no longer use hardcoded filler labels for these surfaces.

---

## 2. Preview summary shows only three real values
**Goal:** Replace the fake preview summary with real summary values.

### Expected user-facing result
The preview should show only:
- pages
- estimated read time
- status

### Required behavior
- Remove fake summary copy.
- Use real values derived from the current book data and reading state.
- Keep the preview compact and readable.

### Acceptance notes
- The summary should not show decorative filler.
- The same summary model should work for local and embedded/manifest books where applicable.

---

## 3. Reading metrics foundation exists for Library and Profile surfaces
**Goal:** Provide real reading data that powers Library and Profile without creating a new competing truth layer.

### Expected user-facing result
Library and Profile surfaces should reflect actual reading activity.

### Required behavior
- Track enough runtime-owned reading data to support:
  - book status
  - estimated reading time / remaining time
  - daily reading minutes
  - rolling weekly reading minutes
  - sessions completed
  - completion state
- Persist this through the correct runtime/prefs seams rather than a shell-owned store.

### Acceptance notes
- This metric layer exists to support the visible surfaces, not to become a second owner.
- Reading truth still belongs to runtime.

---

## 4. Book completion uses the real completion rule
**Goal:** Define completion in a simple, user-readable way.

### Required rule
A book is **Completed** when the reader reaches the last page.

### Acceptance notes
- Completion should not depend on hidden heuristics.
- Completion should be based on actual page progress, not cosmetic state.

---

## 5. Profile uses real reading data
**Goal:** Replace fake or decorative Profile metrics with real reading metrics.

### Expected user-facing result
Profile should show real values for:
- Daily Goal
- This Week
- Sessions Completed

### Required behavior
- Daily Goal uses real accumulated reading minutes.
- This Week reflects real recent reading activity.
- Sessions Completed reflects real completed sessions.

### Acceptance notes
- Profile should stop feeling like a mock surface.
- Values should update from real reading activity.

---

## 6. “This Week” is a rolling last 7 days
**Goal:** Lock the definition of the weekly metric.

### Required rule
**This Week** means the rolling last 7 days.

### Acceptance notes
- Do not treat this as calendar-week-only unless deliberately changed later.
- The metric should roll forward naturally.

---

## 7. “Sessions Completed” is all-time
**Goal:** Lock the meaning of the sessions metric.

### Required rule
**Sessions Completed** means all-time.

### Acceptance notes
- Do not limit this to weekly-only counting.
- The metric should grow over time unless the user’s stored state is explicitly reset by a real reset path.

---

## 8. Daily Goal is editable inline on the card
**Goal:** Make Daily Goal feel like a real usable control, not a mock number.

### Expected user-facing result
The user can edit Daily Goal directly on the card.

### Required behavior
- Daily Goal editing should happen inline on the card.
- The changed value should save.
- The saved goal should persist through the existing prefs-style seam.

### Acceptance notes
- Do not create a separate truth layer for this.
- Keep the UX lightweight and immediate.

---

## 9. Daily Goal shows real radial progress
**Goal:** Add a visual progress indicator that reflects real reading minutes.

### Expected user-facing result
Profile shows a real radial progress display for the Daily Goal.

### Required behavior
- Progress reflects actual reading minutes against the saved goal.
- The display updates as the reader accumulates time.
- The radial indicator is tied to real data, not filler percentages.

### Acceptance notes
- The radial indicator should remain clear at low and high completion values.
- The visual should not imply completion before the goal is actually met.

---

## 10. Goal celebration happens once per day
**Goal:** Make celebration feel intentional instead of spammy.

### Expected user-facing result
When the reader reaches the daily goal, a quick celebration appears once that day.

### Required behavior
- Celebration should happen only once per day.
- Celebration memory should be stored behind the existing prefs-style seam.
- It should not repeatedly fire on the same day after refreshes or repeated navigation.

### Acceptance notes
- The celebration is a moment, not a persistent banner.
- The daily gate must be durable enough to survive normal app usage.

---

## 11. Celebration style is a quick oscillating confetti emoji
**Goal:** Lock the intended celebration feel.

### Required behavior
- Use a quick animated emoji celebration.
- Style target: oscillating confetti emoji moment.
- Keep it brief and non-intrusive.

### Acceptance notes
- Do not turn this into a large modal or heavy interruption.
- It should feel rewarding without hijacking the page.

---

## 12. Help actions actually work
**Goal:** Replace dead Help buttons with working actions.

### Expected user-facing result
The following actions should work:
- Start Chat
- Share your thoughts
- Email

### Required behavior
- Each Help action should trigger its real intended behavior.
- Do not leave visible dead-end controls.

### Acceptance notes
- If a Help integration is present, use it truthfully.
- If email is used, it should open a real email path.

---

## 13. Text becomes a real import option
**Goal:** Add pasted text as a real import path, not a fake extra surface.

### Expected user-facing result
Users can paste text and import it as a real reading item.

### Required behavior
- Add **Text** as a real importer option.
- Imported text should become a real book/item in the library flow.
- Text import should behave like a normal import path, not a detached scratch flow.

### Acceptance notes
- Text import should respect the same general importer honesty standards as file import.

---

## 14. Text import auto-names itself when no title is provided
**Goal:** Prevent titleless text imports from feeling broken.

### Required behavior
- If the user imports text without a title, auto-name it.

### Acceptance notes
- The auto-name should be stable and readable enough for Library use.

---

## 15. Text import uses normal page-breaking behavior for unnumbered text
**Goal:** Keep Text import consistent with the existing importer model.

### Required behavior
- For unnumbered pasted text, use the importer’s normal page-breaking behavior.

### Acceptance notes
- Do not invent a second unrelated paging model just for pasted text.

---

## 16. Importer close or dismiss clears staged file and staged text immediately
**Goal:** Prevent ghost import state.

### Expected user-facing result
When the importer is closed or dismissed, all staged content is gone immediately.

### Required behavior
- Clear staged file state on close/dismiss.
- Clear staged text state on close/dismiss.
- Reopening the importer should show a clean state unless real staged state intentionally still exists.

### Acceptance notes
- No ghost file.
- No ghost text.
- No stale title/body from prior text import attempts.

---

## 17. Successful import returns the user cleanly to Library
**Goal:** Keep import flow calm and obvious.

### Expected user-facing result
After successful import, the user is back in Library and can see the result of the import.

### Required behavior
- Successful file import returns cleanly to Library.
- Successful text import returns cleanly to Library.
- The new or updated item should be visible through normal Library behavior.

### Acceptance notes
- Do not leave the user stranded in a confusing half-import state.

---

## 18. Profile and Library surface cleanup stays unified
**Goal:** Treat these surfaces as one cleanup pass instead of fragmented mini-patches.

### Required behavior
- Keep Profile, Library, Text importer, and Help within one coherent bounded pass.
- Avoid widening into unrelated systems.

### Acceptance notes
- This pass should feel cohesive from the user perspective.

---

## 19. Profile > Subscription uses the new wording
**Goal:** Replace staging-oriented copy with product-facing subscription information.

### Expected user-facing result
Profile > Subscription should show:
- Books
- Storage
- Renews

### Required behavior
- Remove the **Durable Sync** area from this surface.
- Replace it with the expected subscription-facing information.

### Acceptance notes
- This is not merely cosmetic if the current wording implies the wrong product meaning.

---

## 20. Preserve runtime ownership throughout Pass 6
**Goal:** Ensure cleanup does not create shell-owned truth.

### Required behavior
- Reading truth stays runtime-owned.
- Progress truth stays runtime-owned.
- Session truth stays runtime-owned.
- Importer truth stays runtime-owned.
- Shell may present and forward intent, but must not become the deciding owner.

### Acceptance notes
- Do not solve surface problems by introducing shell-side guesses.
- Do not move launch-critical truth into cosmetic code paths.

---

## 21. Use the existing prefs-style seam for goal and celebration memory
**Goal:** Keep persistence architecture disciplined.

### Required behavior
- Daily Goal persists through the existing prefs-style seam.
- Celebration memory persists through the existing prefs-style seam.
- Do not create a parallel storage authority.

### Acceptance notes
- This is a discipline requirement, not just an implementation detail.

---

## 22. Do not add a sidecar data store
**Goal:** Prevent a new duplicate truth layer.

### Required behavior
- Do **not** add a sidecar store such as `js/surface_data.js`.

### Acceptance notes
- Surface cleanup should reuse the existing runtime/prefs seams.
- New state containers are not acceptable for this pass.

---

## 23. Runtime validation is required before calling Pass 6 complete
**Goal:** Completion is based on behavior, not code inspection.

### Required validation areas
- Library row status/time are real.
- Preview summary shows real pages, read time, and status.
- Profile metrics update from real reading behavior.
- Daily Goal edits save and persist.
- Radial goal progress updates correctly.
- Celebration fires once per day only.
- Text import works as a real import path.
- Untitled text auto-names.
- Unnumbered text uses normal page breaking.
- Importer close/dismiss clears staged file and staged text.
- Successful import returns to Library.
- Help actions work.
- Subscription card wording matches the new surface.
- Runtime ownership remains intact.

---

# Explicit out-of-scope items for Pass 6
These may be valid project items, but they are **not** completion requirements for Pass 6 unless the pass is formally reopened and re-scoped.

1. Developer account work for production
2. Auth changes
3. Billing changes
4. Entitlement resolution work
5. Usage policy changes
6. Provider-policy changes
7. Tokens work
8. Backend redistribution of TTS and library logic
9. Break pages by document page number
10. Make displayed pages actual document page numbers
11. Remove sample flow and redirect Free to account creation
12. Broader onboarding/business-flow restructuring
13. New server-side protected-logic redistribution unrelated to the in-scope surfaces

---

# Pass 6 completion checklist

A pass-acceptance reviewer should be able to answer **yes** to all of the following:

- [ ] Library rows no longer show filler status/time.
- [ ] Preview summary shows only real pages, estimated read time, and status.
- [ ] Profile uses real reading data.
- [ ] Book Completed means reaching the last page.
- [ ] This Week means rolling last 7 days.
- [ ] Sessions Completed means all-time.
- [ ] Daily Goal is editable inline on the card.
- [ ] Daily Goal saves and persists.
- [ ] Radial goal progress reflects real reading activity.
- [ ] Goal celebration happens once per day only.
- [ ] Celebration is a quick confetti-style emoji moment.
- [ ] Help actions work.
- [ ] Text import is a real importer option.
- [ ] Untitled text import auto-names itself.
- [ ] Unnumbered pasted text uses normal importer page breaking.
- [ ] Importer close/dismiss clears staged file and staged text immediately.
- [ ] Successful import returns cleanly to Library.
- [ ] Profile > Subscription shows Books, Storage, and Renews.
- [ ] Daily Goal and celebration memory use the existing prefs-style seam.
- [ ] No sidecar store was added.
- [ ] Runtime ownership of reading/progress/session/importer truth was preserved.
- [ ] Pass 6 did not drift into auth, billing, entitlement, usage, or provider-policy work.

