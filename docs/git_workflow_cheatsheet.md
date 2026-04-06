# Reading Trainer Git Workflow Cheat Sheet

This file is meant for the local diff-driven workflow you are using with Git, runtime review, and whichever implementation agent is currently in use.

Use it as a quick reference during the patch loop.

---

## 0. Canonical diff lifecycle

For one active pass:
- create one canonical diff
- runtime-test it
- revise that same diff in place after feedback
- do not stack forward diffs for the same pass
- start a new diff only when the work becomes a new pass

---

---

## 1. Go to the repo

```bat
cd C:\Users\Triston Barker\Documents\GitHub\reading-comprehension\
```

What it does:
- enters the repo root before diff export, review, apply-check, or commit

---

## 2. Check what changed

```bat
git status
```

What it does:
- shows changed files
- shows whether files are staged or unstaged
- confirms which branch you are on

---

## 3. Patch artifact standards

For diff-driven cleanup, use **one named diff file per active pass**.

Recommended default:
- `quick_patch.diff`

Rules:
- keep one named diff artifact per active pass
- prefer pass-specific names when practical
- keep the filename stable while it remains the same pass
- overwrite that file as the pass evolves
- keep the file list scoped to the active pass
- say whether the diff is:
  - a cumulative patch against current repo state, or
  - a follow-up patch against a previously patched base
- do not mix those two without saying so
- always run `git apply --check` before handing the diff off or runtime-testing it

---

## 4. Export a scoped diff for the active pass

Use this when the pass is limited to known files.
The file list below is an example only. Replace it with the files in the current pass.

```bat
git diff -- <file1> <file2> <file3> > quick_patch.diff
```

Example:

```bat
git diff -- docs/index.html docs/css/shell.css docs/js/evaluation.js docs/js/shell.js > quick_patch.diff
```

What it does:
- writes a smaller diff file containing only the listed files
- keeps the patch tied to the active pass
- matches the diff-driven runtime cleanup workflow used for iterative patch revision
- is easier to review and re-export than a whole-repo diff

---

## 5. Validate the diff before handoff or runtime testing

```bat
git apply --check quick_patch.diff
```

What it does:
- verifies that the diff parses and applies cleanly against the intended base
- catches malformed hunks or base-state mismatch before runtime testing

If this fails, fix the diff before continuing.

---

## 6. Open the diff locally for inspection

```bat
notepad quick_patch.diff
```

What it does:
- opens the active patch artifact immediately
- useful for checking hunk accuracy, file scope, and whether the latest correction really landed in the diff

---

## 7. Standard diff-driven review block

This is the block to reuse once a pass has an active patch artifact:

```bat
cd C:\Users\Triston Barker\Documents\GitHub\reading-comprehension\
git status
git diff -- <file1> <file2> <file3> > quick_patch.diff
git apply --check quick_patch.diff
notepad quick_patch.diff
```

Example:

```bat
cd C:\Users\Triston Barker\Documents\GitHub\reading-comprehension\
git status
git diff -- docs/index.html docs/css/shell.css docs/js/evaluation.js docs/js/shell.js > quick_patch.diff
git apply --check quick_patch.diff
notepad quick_patch.diff
```

What it does:
- enters the repo
- confirms current change state
- exports the active pass diff
- verifies the patch applies cleanly
- opens the exact artifact that will be handed off or runtime-tested

---

## 8. Revise the same diff after runtime feedback

Use this when runtime feedback is correcting one remaining behavior inside the same pass.

Rules:
- keep one named diff artifact per active pass
- keep the filename stable while it remains the same pass
- keep the same file scope unless runtime proves a new owner file is needed
- regenerate the same diff after each correction
- run `git apply --check` again after each revision

This is the preferred loop once the owner layer and patch artifact are stable.
Often that is after the first 1–2 Claude implementation passes, but treat that as a heuristic rather than a hard threshold.

---

## 9. Export a whole-repo diff only when the whole repo is truly in scope

```bat
git diff > repo-pass.diff
```

What it does:
- writes a diff of all current unstaged changes
- useful only when the entire active pass is intentionally broad

Do not use this by default for a narrow runtime pass.

---

## 10. See the diff directly in terminal

```bat
git diff
```

What it does:
- prints the current unstaged diff in the terminal
- good for a quick check before exporting or committing

---

## 11. See the names of changed files only

```bat
git diff --name-only
```

What it does:
- lists only the file paths that changed
- useful when you only want a quick scope check

---

## 12. Stage only the files in the pass

```bat
git add <file1> <file2> <file3>
```

Example:

```bat
git add docs/index.html docs/css/shell.css docs/js/evaluation.js docs/js/shell.js
```

What it does:
- stages only the files you name
- keeps commit scope aligned with the active pass
- is safer than staging the whole repo during a narrow cleanup loop

---

## 13. Commit the staged changes

```bat
git commit -m "Polish reading playback follow-up"
```

What it does:
- creates a commit from staged changes
- use a message that describes the user-facing purpose of the pass

---

## 14. Show the most recent commit

```bat
git log --oneline -1
```

What it does:
- shows the latest commit hash and message
- useful when you need the hash for review or rollback

---

## 15. Export the last commit as a patch-style file

```bat
git show --stat --patch HEAD > last-commit.txt
```

What it does:
- writes the latest commit diff to a readable file
- useful after commit when you want to review exactly what got saved

---

## 16. Compare current branch against main

```bat
git diff main...HEAD > branch-vs-main.diff
```

What it does:
- shows the changes on your current branch compared to `main`
- useful when working in a Claude-created branch or worktree

---

## 17. Check which branch you are on

```bat
git branch --show-current
```

What it does:
- prints the current branch name only
- useful when you want to make sure you are not committing to the wrong branch

---

## 18. Safe sequence before commit

```bat
cd C:\Users\Triston Barker\Documents\GitHub\reading-comprehension\
git status
git diff -- <file1> <file2> <file3> > quick_patch.diff
git apply --check quick_patch.diff
```

Then:
- review the diff in GitHub Desktop or Notepad
- test runtime
- only then run `git add ...` and `git commit -m "..."`

---

## 19. Rule of thumb

Use:
- `git status` to know the state
- `git diff -- <files> > quick_patch.diff` to keep the patch scoped
- `git apply --check quick_patch.diff` to verify the artifact before handoff or runtime testing
- `git add` only after review
- `git commit` only after runtime testing when the pass is important
