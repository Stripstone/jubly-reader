# Jubly Reader — Notes & Flashcards Runtime UX Contract

Status: accepted / runtime-tested feature contract  
Accepted artifact: `jubly-reader-notes-flashcards-modal-mutation-cohesion-rev19.zip`  
Scope: Reading View annotations, notes, flashcards, revisit modal, shared floating utility host, local/cache/server annotation trust, and safe source navigation.

---

## 1. Feature setting

Location:

```text
Reading View → Settings → General → Notes & Flashcards Widget
```

### Setting OFF

When the setting is off:

- No Notes/Flashcards utility appears.
- No annotation entrypoint appears below the page.
- No note or flashcard creation UI appears.
- Existing Help behavior remains available according to Help's own visibility state.
- Reading, navigation, and TTS behave exactly as before.

### Setting ON

When the setting is on:

- Notes/Flashcards becomes available as a floating utility.
- Annotation creation becomes available only when TTS is paused.
- Reading/navigation should still feel unchanged.
- TTS playback, seek, provider behavior, and playback ownership must not be rewired by this feature.

---

## 2. Floating utility host

The floating utility surface is a future-friendly host for multiple reading utilities.

### Utility availability rule

Available utilities are derived from current state before rendering the floating host.

```text
available utilities =
  Notes/Flashcards if enabled
  Help if Help is currently eligible/mounted and not hard-closed
  future utilities if eligible
```

Hard-closed Help must not be counted as an available shared utility.

### Zero utilities

- Render no floating utility host.

### One utility

If only one utility is available:

- Render that utility as the standalone collapsed widget.
- Do not add an extra shared launcher.

Examples:

```text
Only Help available → Help appears standalone.
Only Notes/Flashcards available → Notes appears standalone.
```

### Multiple utilities

If two or more utilities are available:

- Show one collapsed shared launcher.
- Clicking/tapping the launcher expands available utilities upward.
- Selecting a utility opens that utility.
- Only one utility panel/modal may be open at a time.

### Conflict rule

```text
Open Notes/Flashcards → Help closes.
Open Help → Notes/Flashcards closes.
```

No overlapping floating panels. No stacked open panels. No stale Help layer may block Notes selection after Help is minimized or hard-closed.

---

## 3. Annotation entrypoint

The annotation entrypoint appears below page text and above reading navigation.

### Visibility rule

The annotation area is not visible at all unless TTS is paused.

When TTS is playing:

- No annotation dropdown is visible.
- No save controls are visible.
- No creation UI is visible.
- Playback is not interrupted.

When TTS is paused:

- The annotation entrypoint appears.
- The entrypoint may read:

```text
Annotate current highlight
```

- The current highlighted / active reading block is the annotation target.

### No playback ownership

Annotation UI must not auto-pause TTS.  
Annotation UI must not seek TTS.  
Annotation UI must not start or resume playback.

---

## 4. Active highlight ownership

A highlighted block can have at most one active annotation in this phase.

Allowed annotation types:

- Note
- Flashcard

If the highlighted block has no saved annotation:

- Show creation options.

If the highlighted block already has a saved note:

- Show only that note.
- Do not show creation options.
- Show Edit and Delete.

If the highlighted block already has a saved flashcard:

- Show only that flashcard.
- Do not show creation options.
- Show Edit and Delete.

Deleting the saved annotation resets that highlighted block to the unclaimed state and restores creation options when appropriate.

---

## 5. Creating a note

Starting state:

- TTS is paused.
- Annotation entrypoint is visible.
- Current highlighted block has no saved annotation.

User flow:

```text
Open annotation dropdown
→ Make Note
→ note form opens
→ highlighted passage is shown as context
→ user types note
→ user clicks Save note
```

Expected result:

- Note is saved to the active highlighted block.
- Input closes.
- The saved note is shown in the annotation area.
- Creation buttons are hidden for that block.
- Reading position does not change.
- TTS/playback is not touched.

Copy rule:

```text
First action: Make Note
Actual persistence action: Save note
```

---

## 6. Creating a flashcard

Starting state:

- TTS is paused.
- Annotation entrypoint is visible.
- Current highlighted block has no saved annotation.

User flow:

```text
Open annotation dropdown
→ Make Flashcard
→ flashcard form opens
→ highlighted passage is shown as context
→ front/back fields are shown empty
→ user edits front/back
→ user clicks Save card
```

Expected result:

- Flashcard is saved to the active highlighted block.
- Form closes.
- The saved flashcard is shown in the annotation area.
- Creation buttons are hidden for that block.
- Reading position does not change.
- TTS/playback is not touched.

### Flashcard creation fields

- Front/back fields must not auto-hydrate from highlighted text.
- Highlighted text is context only.
- Empty fields are easier to type into and avoid accidental duplicated long passages.

### Inline flashcard display

A saved inline flashcard should support one-side-at-a-time review:

```text
Front → click → Back → click → Front
```

---

## 7. Inline edit/delete behavior

Inline annotation edit is the reference behavior for modal edit.

### Inline Edit

When user clicks Edit on an inline note or flashcard:

- The saved display is replaced by the edit form.
- The highlighted passage remains visible as context.
- Only Save/Cancel for the edit state should appear.
- The old Edit/Delete action row must not remain stacked underneath the edit form.
- The edit form must not rehydrate, collapse, or reset while typing.

### Inline Delete

Delete should be immediate in the UI/local cache.

Expected:

```text
Click Delete
→ item disappears immediately
→ highlighted block becomes unclaimed
→ creation options return when appropriate
→ server hard-delete is pushed
→ later server hydrate must not resurrect the deleted annotation
```

No redundant “Deleted.” notification is needed.

---

## 8. Page / highlight changes

When the user moves with Next or Previous:

- The active highlighted block changes.
- The annotation area reflects the annotation state for the new highlighted block.
- If the new block has no saved annotation, creation options are available once paused.
- If the new block has a saved note, show only that note.
- If the new block has a saved flashcard, show only that flashcard.
- Prior page/block annotations must not bleed into the new highlighted block.

---

## 9. Notes/Flashcards modal

The Notes/Flashcards modal is the revisit and management surface.

It opens from the Notes/Flashcards utility and contains tabs:

```text
Notes | Flashcards
```

The modal is centered with a maximum height and internal scrolling for long lists.

Close behavior:

- X closes the modal.
- Pointer/tap down on the backdrop may close the modal.
- Pointer/tap release must not accidentally close the modal.
- Internal modal clicks must not bubble into backdrop close.

### Modal list item inactive state

Notes and flashcards should use a consistent inactive card style.

Inactive state is for browsing:

- It should look selectable but not already active.
- It should not show active-only labels such as `Front` on flashcards.

---

## 10. Modal note behavior

### Inactive note item

A collapsed note item shows:

- type label: Note
- short note preview
- plain metadata row:

```text
CH: “Survey Meth…” · Page 2 · “Visibility may be: high in plowed f…”
```

- action row:

```text
Source | Edit | Delete
```

Metadata is plain text, not a link.

### Active/open note item

Clicking the note body expands it in place.

Expanded state shows:

- highlighted passage/source content at the top
- note text below
- source metadata remains available

Clicking the highlighted passage/source area collapses the item.

---

## 11. Modal flashcard behavior

Flashcards should support active recall, not passive front/back review.

### Inactive flashcard item

A collapsed flashcard item shows:

- type label: Flashcard
- front text preview only
- no `Front` label while inactive
- plain metadata row:

```text
CH: “Survey Meth…” · Page 2 · “Visibility may be: high in plowed f…”
```

- action row:

```text
Source | Edit | Delete
```

### Active flashcard item

First click on the flashcard body:

- activates/expands the item
- shows highlighted passage/source content above the card
- still shows Front
- does not flip yet

Subsequent clicks on the active card:

```text
Front → Back → Front
```

Clicking the highlighted passage/source area collapses the flashcard and resets it to inactive Front state.

### Edit mode exception

Edit mode may show both front and back fields because the user is editing, not reviewing.

---

## 12. Modal edit behavior

Modal edit must use the same stable edit-state pattern as the working inline annotation editor.

When user clicks Edit in the modal:

- The item enters edit mode in place.
- The highlighted passage/source context appears at the top.
- The note textarea or flashcard front/back fields appear below.
- Only the edit controls appear:

```text
Save | Cancel
```

- The normal action row must be hidden:

```text
Source | Edit | Delete
```

- The edit form must not rehydrate, collapse, scroll-jump, or reset while typing.
- Re-rendering should happen only after Save or Cancel.

---

## 13. Modal delete behavior

Modal delete must route through the same local-first mutation path as inline delete.

Expected:

```text
Click Delete
→ item disappears immediately from modal
→ item disappears from inline surface if it is the active block
→ local cache records deletion/tombstone
→ server hard-delete is pushed
→ later server hydrate must not resurrect it
```

No redundant “Deleted.” notification is needed.

---

## 14. Source behavior

The Source action is the only modal action that attempts reading navigation.

Normal source action label:

```text
Source
```

Do not use:

```text
Unavailable
View source
```

### Same chapter Source

If the saved annotation belongs to the current chapter:

- Close/minimize modal.
- Navigate/scroll to the saved page/source area using one smooth page-level scroll.
- Do not perform stacked page-scroll plus block-scroll correction.
- Do not highlight-pulse or invent competing emphasis.
- Do not start playback.
- Do not pause playback.
- Do not seek TTS.

### Different chapter Source

If the annotation belongs to a different chapter:

- Keep the modal open.
- Keep Source clickable.
- Show discreet copy:

```text
Open this chapter to view the source.
```

Do not invent a chapter transition unless using an existing, proven chapter-selector/runtime seam.

---

## 15. Storage and trust contract

Annotations are out-of-book user content.

Durable owner:

```text
Supabase / backend durable layer
```

Runtime/page owner:

```text
Reading runtime supplies the active anchor only.
```

### Trust order

Annotation state uses this trust order:

```text
1. User action truth
2. Local cache truth
3. Server durable truth
```

Meaning:

- User saves/edits/deletes update UI and local cache immediately.
- Client pushes the mutation to server immediately.
- Server hydrate fills gaps when cache has no newer user/cache truth.
- Server hydrate must not overwrite newer local saves/edits/deletes.
- Pending local rows must not disappear merely because a server refresh did not include them yet.
- Tombstones must prevent deleted server rows from reappearing after hydrate.

### Required anchor fields

Stored annotation needs enough anchor data to return to source:

```text
user_id
library_item_id / book_id
annotation_type: note | flashcard
note_text
flashcard_front
flashcard_back
chapter_index
page_index
page_key
block_index
highlighted_text
text_hash
created_at
updated_at
deleted_at or deletion equivalent
```

Do not store annotations inside imported book content.

### Book independence

Annotations must be scoped to the current book/library item.

- Notes/flashcards from one book must not appear in another book.
- Empty/unknown book identity must not be treated as a valid annotation target.
- Hydration and local filtering must include book identity.

### Delete semantics

Current phase uses hard delete from active `user_annotations` rows.

`deleted_at` may remain in schema for future compatibility, but no visible Trash/restore surface exists for annotations in this phase.

---

## 16. Server payload rules

Server canonicalization must not copy highlighted text into note or flashcard fields.

Allowed:

- `highlighted_text` stores source context.
- `note_text` stores user-entered note text.
- `flashcard_front` stores user-entered front text.
- `flashcard_back` stores user-entered back text.

Forbidden:

- auto-filling `flashcard_front` from highlighted text
- auto-filling `flashcard_back` from highlighted text
- duplicating highlighted passage into editable fields

---

## 17. TTS runtime rule

Annotation creation and revisit must not interfere with playback.

Locked behavior:

```text
TTS playing → annotation entrypoint hidden
TTS paused → annotation entrypoint visible
```

No auto-pause.  
No playback rewiring.  
No TTS seek.  
No jump-to-marker command in this phase.

---

## 18. Non-goals for this phase

Do not implement in this phase:

- AI note suggestions
- Comprehension mode
- Thesis mode
- inline note markers inside text
- TTS seek-to-annotation
- auto-pause on widget open
- playback resume from annotation
- hard study dashboard
- flashcard spaced repetition
- cross-chapter source navigation unless routed through an existing proven chapter-selector/runtime seam

---

## 19. Final accepted user flow

```text
Turn on Notes & Flashcards Widget
→ Read normally
→ Pause TTS when desired
→ Annotation entrypoint appears
→ Make Note or Make Flashcard tied to current highlighted block
→ Continue reading
→ Later open Notes/Flashcards modal
→ Review Notes or Flashcards tab
→ Expand an item to see highlighted source context
→ Edit/delete directly in the modal if desired
→ Use Source to return to source only when safe
```

---

## 20. Runtime validation path

1. Setting OFF hides Notes/Flashcards utility and annotation entrypoint while leaving Help behavior intact.
2. Setting ON + TTS playing shows Notes utility but no annotation entrypoint.
3. TTS paused shows annotation entrypoint.
4. Make Note opens empty note field with highlighted passage context; Save note claims that block.
5. Make Flashcard opens empty front/back fields with highlighted passage context; Save card claims that block.
6. Claimed blocks show only their saved annotation plus Edit/Delete; creation options are hidden.
7. Next/Previous reflects the active block’s own annotation state without bleed.
8. Inline Edit shows highlighted passage + editor + Save/Cancel only.
9. Inline Delete immediately removes the annotation and restores creation options.
10. Notes modal opens from utility host and scrolls internally with many rows without jitter.
11. Note item expands to show highlighted passage above note text; source passage click collapses.
12. Flashcard item starts inactive without `Front` label; first click activates without flipping; later clicks flip Front/Back; source passage click collapses and resets inactive.
13. Modal Edit shows highlighted passage + editor + Save/Cancel only; it does not rehydrate/collapse while typing.
14. Modal Delete immediately removes and does not resurrect after refresh/hydrate.
15. Source same-chapter uses one smooth page-level scroll and no TTS seek/play/pause.
16. Source wrong-chapter stays in modal and shows `Open this chapter to view the source.`
17. Help + Notes share the utility host only when both are active; hard-closed Help is not counted.
18. Notes from one book do not appear in another book.
