# Jubly Reader — Runtime Contract

This document defines the behavior the user should experience.

If code, UI ideas, or implementation shortcuts conflict with this document, this document wins.

## Core promise
The user should be able to:
- open the app
- choose or import a document
- enter reading cleanly
- read page by page
- use TTS reliably
- leave reading without lingering state
- return to the correct place later

## Runtime experience evaluation lens

Use this section to judge runtime behavior during testing.

This is not a second ownership model.
It is the user-facing way to judge whether the current implementation is behaving honestly.

For the categories below, judge all five:
- client immediate
- mutations
- server settle
- later truth
- must not happen

### 1. State transitions
Sign-in, refresh, reading entry, reading exit, and sign-out: correct or incorrect.

**Client immediate:** account and continue surfaces are blank if nothing is loaded yet, or filled with the last client-captured state if that is safe to show.

**Mutations:** when I sign in, sign out, leave reading, or come back, the visible state should react right away.

**Server settle:** the app checks the real account state, saved settings, and saved reading place in the background.

**Later truth:** once loading finishes, I should still be in the right account state and the right continue state.

**Must not happen:** no stale signed-in state after sign-out, no wrong account surface flashing first, no old continue state sticking around after the app learns better.

### 2. Settings
User-controlled settings and profile-style preferences: responsive or unresponsive.

**Client immediate:** when I change a setting, I should see it change right away.

**Mutations:** new setting changes should appear immediately in the UI, even if the real save is still finishing in the background.

**Server settle:** the real saved setting is written and confirmed through the account-backed path.

**Later truth:** after refresh, reopen, or another device, it should still be set the way I left it.

**Must not happen:** no setting that changes and then snaps back for no reason, no local-only setting pretending it was truly saved, no duplicate owner between shell and runtime.

### 3. Value rendering
Displayed values like goals, usage, plan info, account info, and continue labels: responsive or unresponsive.

**Client immediate:** values are blank, loading, or filled with the last safe client-captured value. New changes should show right away.

**Mutations:** when plan, usage, or account-backed values change, the screen should react quickly without inventing fake numbers.

**Server settle:** the app loads the real values and replaces placeholders or older local values.

**Later truth:** the values on screen should end up matching the real saved account state and resolved entitlement state.

**Must not happen:** no made-up usage count, no fake plan state, no decorative value that looks real but is only a local guess.

### 4. Reading continuity
Chapter, page, continue reading, and restore behavior: responsive or unresponsive.

**Client immediate:** when I open a book, the app should either wait briefly for the right place or show a safe loading state.

**Mutations:** when my page changes, when I leave reading, or when I reopen later, my place should update and stay current.

**Server settle:** the app checks the real saved reading place in the background and lets runtime apply it.

**Later truth:** I should end up on the right chapter and page, and leaving and returning should keep bringing me back to that place.

**Must not happen:** no flash of page 1 while catching up to server, no snap from the wrong page to the right page after the user already saw the wrong one, no stale old-book or old-chapter restore, no restore path that only works from one special entry path.

## Responsiveness patterns required by this contract

These are implementation-neutral user-experience rules.
They exist so the app feels immediate without lying about durable truth.

### Render the safe state before slow work
If a transition needs a pending, hidden, or locked safe state, that state must appear before any await or network roundtrip that could stall the visible surface.

Examples:
- reading entry should hide stale pages before any progress flush or restore fetch that could take time
- dashboard/library surfaces should not expose intermediate signed-out, empty, or stale states while account-backed truth is still resolving
- a modal shell may open immediately while server-backed verification continues in the background

### Open fast, lock actions, verify in background
When local knowledge is enough to present a safe shell, open the surface immediately.
If the action itself depends on server-backed truth, keep the relevant action controls locked until verification settles.

Examples:
- importer modal may open from local state immediately
- import / scan / submit actions may stay disabled until capacity or permission checks are confirmed

### Use hydration or confirmation seams, not guessed readiness
A surface that depends on account-backed durable truth should gate on an explicit hydration or confirmation signal when needed.
Do not treat a derived getter or a fallback value as proof that server-backed data is actually ready.

### Cache may improve responsiveness, not replace authority
Last-safe cached values may be used for immediate display.
Dirty local intent may be replayed after refresh.
But the cache must not become a second durable authority or blindly overwrite fresher server truth.

### Visible surfaces should not jump while truth settles
If a label, subtitle, status line, or similar surface is expected to change after hydration, reserve its space or otherwise stabilize its placement so the page does not shake or shift while text updates.

**Must not happen:** no form-submission feel for routine UI transitions, no buffering-video feel for reading entry, no modal that appears late because its shell waited on verification, no visible layout shake caused by late-arriving subtitle or status text.

## How to use this during testing

When runtime testing:
1. judge the category
2. write what happened at client immediate
3. write what changed during mutation
4. write what settled later
5. write the exact failure pattern if one occurred

A result is not considered correct just because it settled eventually.
If the app shows a believable wrong state first, that is still a runtime failure.

## Reading contract

### Cold open
What must be true:
- library and profile feel centered and intentional
- advanced controls do not dominate the first screen
- logged-in users are not forced through unnecessary friction
- navigation stays inside app flow where expected

### Import or select
What must be true:
- document selection is obvious
- importer close or dismiss clears staged file state
- the UI never implies a file is still pending when it is not
- the UI never loses a staged file silently either

### Enter reading
What must be true:
- the selected source opens correctly
- if a valid restorable session exists, the user is not dumped onto a misleading fresh page 1
- reading controls reflect actual current state

### Reading mode
What must be true:
- reading controls stay reachable on narrow widths
- the reading layout stays stable across themes
- page flow is understandable and not game-like
- themes change appearance and ambience only, not reading flow truth

### Reading settings
What must be true:
- reading settings are organized into General, Sound & Music, and Themes
- tabs stack on mobile
- tabs use a left-side vertical rail on larger viewports
- Themes always exists, even when the active theme has no extra customization yet

### Explorer theme
What must be true:
- Explorer visuals are scoped to reading content only
- bars stay governed by global Light/Dark appearance
- Explorer offers Plain, Texture, and Wallpaper reading-background modes
- Wallpaper is the default Explorer background mode
- embers appear only in reading and remain visually contained there
- Explorer customization persists when switching away and back
- reset restores Explorer defaults cleanly

### Music in Themes
What must be true:
- music selection lives in the Themes tab
- the picker opens in a child modal above reading settings
- built-in default music remains available
- one Custom row supports upload and delete
- deleting custom falls back to built-in default
- custom file persistence is device-local only

### Page navigation
What must be true:
- Next advances to the next page
- last page wraps to the top if that remains the intended behavior
- page progress is subtle but clear

## TTS contract
TTS must feel assistive, not fragile.

What must be true:
- playback starts only on explicit user action
- playback targets the current active page
- `Read page` and bottom-bar playback reflect one shared runtime truth
- pause/play reflects real runtime state
- changing speed during active TTS updates the current speech immediately when the active path supports it
- if a path cannot mutate speed truly live, runtime uses one defined fallback consistently
- speed remains correct on fresh start, resume, and page transition
- highlighting is close enough to feel helpful
- autoplay countdown is understandable and cancelable
- leaving reading stops reading-owned audio cleanly

## Importer contract
What must be true:
- opening importer shows a clean state unless a real staged state exists
- closing importer clears staged file state
- dismissing importer clears staged file state if dismiss is a supported close path
- reopening importer never reveals ghost state

## Library contract
What must be true:
- if books exist, user sees loading to populated, or immediate populated
- if no books exist, user sees loading to empty guidance
- the app never implies “you have no books” before it has checked

## Footer contract
What must be true:
- if content is taller than the viewport, footer is below content and reached by scrolling
- if content is shorter than the viewport, footer sits at the bottom of the viewport
- footer never overlays library/profile content

## Exit and return-later contract

### Leaving reading
What must be true:
- one exit action runs one cleanup path
- no lingering reading-owned TTS, countdown, or music remains active outside reading
- transient reading-only UI state is cleared

### Return later
What must be true:
- the user returns to the correct page
- restore does not depend on one special entry path
- when signed in, this same continuity should later extend across devices

## Acceptance checks
A build is acceptable only if all of the following are true:
- reading entry is correct
- current page playback is correct
- pause/play is truthful
- speed is truthful, including during active TTS where supported
- importer state is honest
- library state is honest during load
- exit cleanup is complete
- restore lands on the correct page
- footer never covers content
- theme changes do not change reading layout or runtime reading truth
