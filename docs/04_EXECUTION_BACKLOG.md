# Jubly Reader — Execution Backlog

This is the current working backlog.

Each item should answer:
- what the user expects
- what can go wrong
- who owns the fix
- what “done” means

Backlog items should stay behavior-first and objective.
Each launch-critical item should make user expectation, edge cases, owner, and done-when criteria obvious enough that an engineer does not have to infer the intended behavior.

## Execution note
Once the owner layer is known, one active pass should usually map to one active diff artifact.
Revise that same diff after runtime feedback before reopening architecture.
Create a new diff only when the work becomes a new pass.

## Diagnostics rule
Add temporary proof instrumentation before patching when:
- the runtime symptom is real, but the owner path is still ambiguous
- two or more plausible owner files could explain the same symptom
- code inspection has produced competing theories without runtime proof
- a previous patch attempt failed or fixed the wrong layer
- races, stale state, or competing callers are plausible

Diagnostics must be:
- narrow
- removable
- aimed at one failing case end-to-end
- used to reduce the issue to one owner path before behavior patching

## Status
- Open
- In Progress
- Built
- Validated
- Deferred

## Risk
- 🔴 Critical
- 🟡 High
- 🟢 Normal

## 1. Restore returns the user to the correct page
**Risk:** 🔴 Critical  
**Status:** Open  
**Owner:** `js/state.js` with `js/library.js`

### User expectation
When the user leaves and comes back, they return to the right page.

### Edge cases
- refresh
- leave reading then return later
- open a different book after a prior session existed
- restore path should not depend on one special UI entry route

### Done when
- reading position persists after page advance
- returning lands on the correct page
- starting a new source replaces stale restore truth cleanly

---

## 2. TTS starts on the current active page
**Risk:** 🔴 Critical  
**Status:** Open  
**Owner:** `js/library.js` + `js/tts.js`

### User expectation
If the user presses `Read page` or `Play`, the app reads the page they are actually on.

### Edge cases
- restored session
- changed active page before pressing play
- page-card read versus bottom-bar play

### Done when
- page-card read and bottom-bar play target the same runtime page truth
- restored session play starts on the restored page

---

## 3. Pause and resume feel real during active TTS
**Risk:** 🔴 Critical  
**Status:** Open  
**Owner:** `js/tts.js`

### User expectation
When the user presses Pause, reading pauses. When they press Play or Resume, reading resumes in a defined way.

### Edge cases
- mid-sentence pause
- immediate resume
- browser path versus cloud/audio path
- top, bottom, and page-level controls staying in sync

### Done when
- pause changes runtime state intentionally
- resume uses one defined runtime path
- controls do not claim success if runtime state did not change

---

## 4. Speed changes behave live and consistently
**Risk:** 🔴 Critical  
**Status:** Open  
**Owner:** `js/tts.js`

### User expectation
Changing speed during active TTS should affect the current speech immediately when the active path supports it.

### Edge cases
- mid-sentence speed change
- pause/resume after a speed change
- page transition after a speed change
- paths that cannot mutate speed truly live

### Done when
- speed is correct on fresh start
- speed is correct after pause/resume
- speed is correct after next-page transition
- changing speed during active TTS updates current speech immediately when supported
- if a path cannot do that, runtime uses one defined fallback consistently

---

## 5. Leaving reading runs one cleanup path
**Risk:** 🔴 Critical  
**Status:** Open  
**Owner:** `js/tts.js` + `js/audio.js` + `js/library.js`

### User expectation
Leaving reading stops reading-owned audio and clears reading-only transient state.

### Edge cases
- exit during countdown
- exit while TTS is active
- exit after pause
- leave via different supported navigation paths

### Done when
- one runtime-owned exit path handles cleanup
- no lingering reading-owned audio or countdown remains active outside reading

---

## 6. Library startup state must not mislead the user
**Risk:** 🔴 Critical  
**Status:** Open  
**Owner:** `js/library.js`

### User expectation
The app should not briefly imply there are no books before it checks.

### Edge cases
- saved books on slow load
- first-time empty library
- repeated entry into library

### Done when
- saved-books users see loading to populated, or immediate populated
- empty users see loading to true empty state
- no false empty/import flash appears first

---

## 7. Footer sits at the bottom of the page and never covers content
**Risk:** 🟡 High  
**Status:** Open  
**Owner:** shell structural CSS

### User expectation
The footer belongs at the bottom of the page.

### Edge cases
- short content on a tall viewport
- long content requiring scroll
- narrow library/profile screens

### Done when
- short pages place footer at the bottom of the viewport
- long pages place footer below the content
- footer never overlays library/profile containers

---

## 8. Importer close/dismiss clears staged state completely
**Risk:** 🔴 Critical  
**Status:** Open  
**Owner:** `js/import.js`

### User expectation
Closing importer means the staged file is gone.

### Edge cases
- close button
- click-away dismiss if supported
- close after scan
- reopen after prior staging

### Done when
- closing importer clears staged file and parsed state
- reopening importer shows a clean state
- no ghost file remains waiting to scan

---

## 9. Shell stops deciding runtime truth in critical areas
**Risk:** 🔴 Critical  
**Status:** Open  
**Owner:** shell/runtime redistribution pass

### User expectation
Controls should reflect what the app is actually doing, not what the shell guessed.

### Edge cases
- restore
- playback
- importer state
- countdown state
- runtime changes happening behind shell UI

### Done when
- shell no longer decides restore, playback, importer, or countdown truth
- runtime APIs are the only decision paths for launch-critical state
- UI stays synchronized by reading runtime state, not inferring it
- no shell bridge is removed until the runtime replacement exists and is tested

---

## 10. Switching book or chapter must replace page state cleanly
**Risk:** 🔴 Critical  
**Status:** Validated  
**Owner:** `js/library.js`

### User expectation
Changing book or chapter should show only the pages for that selected source.

### Edge cases
- restored session then switching book
- restored session then switching chapter
- leaving reading and returning before changing chapter
- preview entry versus in-reading chapter change

### Resolution note
The accepted fix stayed in the runtime path.
Chapter change now routes through the authoritative rendered-replacement path, so selecting a new chapter immediately replaces rendered page cards without requiring a later Load click.

### Validation note
Validated in the served app.
Confirmed:
- chapter changes replace rendered cards immediately
- stale previous-chapter cards are not left visible
- fast repeated chapter changes do not inherit stale chapter content
- normal Load flow still works after the fix

### Done when
- switching book or chapter fully replaces rendered page state
- stale prior-source cards do not remain visible
- restore and later reading still behave normally after the switch

---

## 11. Isolated theme system is implemented and runtime-owned
**Risk:** 🟡 High  
**Status:** Validated  
**Owner:** `js/state.js` + `js/shell.js` + live shell CSS

### User expectation
Theme choice, Explorer customization, and global appearance should feel coherent without changing reading flow truth.

### Confirmed implementation
- runtime owns theme truth
- runtime owns appearance truth
- shell controls route through runtime APIs
- Explorer customization lives in Reading Settings → Themes
- Profile Appearance is global Light/Dark only
- Explorer visuals are reading-only
- Explorer supports Plain, Texture, and Wallpaper background modes
- custom music is bounded, local-only, and separate from durable preferences
- runtime owns Explorer/custom-music access checks

### Validation note
Validated to the point of implementation-safe acceptance.
Small cleanup may still occur later, but this is now a stable implemented system rather than backlog-planning work.

### Done when
- keep documentation aligned with the implemented theme surface
- future work treats this as current reality rather than unbuilt design

---

## 12. CSS surface alignment for themes remains deferred debt
**Risk:** 🟢 Normal  
**Status:** Deferred  
**Owner:** future scaffold/CSS redistribution pass

### User expectation
Theme changes should continue to work; users do not care which CSS file the rule lives in.

### Current debt
The intended CSS split is still:
- structure in `components.css`
- appearance in `theme.css`

But the live implementation surface today is:
- `css/shell.css`

### Why deferred
Reactivating dormant CSS files during the bounded theme pass would have turned the work into a broader scaffold redistribution/refactor.

### Done when
- decide whether `components.css` and `theme.css` will become live again
- migrate structure and appearance deliberately in one contained pass
- update docs at the same time so file map and live runtime match

---

## 13. Theme asset and local-asset subsystem cleanup remains deferred
**Risk:** 🟢 Normal  
**Status:** Deferred  
**Owner:** future theme/supporting-assets pass

### Current debt
- wallpaper/local asset placement still needs a cleaner final home in the live scaffold
- `music.js` is acceptable but still a narrow single-purpose local-asset path

### Done when
- wallpaper/assets are localized cleanly in the live scaffold
- supporting local asset handling is reviewed as a system rather than as one-off theme utilities

---

## 14. Crown-jewel browser logic exposure is reduced before launch
**Risk:** 🔴 Critical  
**Status:** Open  
**Owner:** runtime/backend redistribution pass

### User expectation
The product should remain fast and truthful locally without shipping avoidable crown-jewel logic in the public browser bundle.

### Edge cases
- TTS provider selection and fallback policy
- premium resolution or usage enforcement duplicated in client JS
- prompts or orchestration rules exposed in browser-delivered code
- moving too much off-client and degrading reading responsiveness

### Done when
- crown-jewel decision logic has been identified explicitly
- browser-delivered code keeps only what must remain local for responsive reading behavior
- provider policy, premium resolution, usage enforcement, and other high-value non-obvious rules move backend-side where feasible
- launch does not depend on obfuscation alone as the protection model
- runtime contract remains intact after redistribution
