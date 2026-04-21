### APENDED shell rework
LeftNav
 - Library
 - Resume Last Read
 - History
 - Settings


Profile
 - Add History
 - Add an Analytic "Pages Today" under "This Week"
 - Move "Get Help" to Settings

Library
 - 

 Reading View
 - 


### Append outstanding work
 
 # server storage of books
- In Library, Manage, instead of only delete, allow to add to server
**Entitlements Notes**
- Server book storage will replace current storage limits 2.. etc.
- New global storage cap of 20 books
 # 

# Jubly Reader — Backlog Sections 5–7

A cleaned and developer-readable backlog slice focused on the enhancement groups most likely to affect visible shell and UI structure.

---

## 5. Enhancements Backlog — First Batch

### 5.1 Chapter Builder in Importer
**What it is**  
An advanced importer option called **Customize Chapters** that lets users adjust chapter breakpoints before finishing an import.

**What it adds**  
- Remove a breakpoint to merge adjacent chapters
- Search within a chapter to find a better split point
- Add a new breakpoint at a selected location

**Why it matters**  
Gives users more control over document structure before the book enters the library.

**Placement**  
- Same importer modal  
- No new page  
- **Advanced** owns the configuration that activates this mode, including **chapter count**
- Once active, the **left contents list** is the editing surface for chapter names
- Small page-count labels sit at the right end of chapter rows
- Right preview panel remains unchanged

---

### 5.2 Preview Rail / Page Map
**What it is**  
A slim vertical rail in reading view that shows chapter position and small nearby page or focus-card previews.

**What it adds**  
- Persistent position indicator in long readings
- Nearby-page preview behavior
- Faster visual navigation through dense content

**Why it matters**  
Helps the reader feel oriented inside a long document.

**Placement**  
- reading view
- general settings toggle

---

### 5.3 Resume Reading Link in Leftnav
**What it is**  
A simple **Resume Reading** link in the left navigation that opens the most recently active book at the saved position.

**What it adds**  
- Quick return path from navigation
- Saved-position re-entry shortcut

**Why it matters**  
Reduces friction between opening the app and getting back into reading.

---

### 5.4 Continue Reading Shortcut - little UX work needed
**What it is**  
A quick-access continue action for the user’s last active reading position, designed to resume reading immediately instead of opening a large library surface.

**What it adds**  
- Direct resume to the current book

**Why it matters**  
Makes continuation the clearest next action with the least friction.

**Placement**   
- Leftnav  
- Opens a minimal right popout  
- Popout shows current book name, chapter # and last page 
- Resume action lives inside the popout

---

### 5.5 Sleep Timer
**What it is**  
A minimal reading-view timer shown in **General Settings** that stops TTS after a chosen duration.

**What it adds**  
- Timed stop option
- Active timer state shown beside the setting
- Reset control beside the active timer
- Alert when the sleep timer goes off

**Why it matters**  
Useful for nightly reading and hands-off listening without adding extra reading-view clutter.

**Clarifications**  
- Lives in **Reading View → General Settings**
- Active timer is shown beside the setting and includes **Reset**
- When triggered, it only **stops TTS**
- It then shows an alert that the **sleep timer went off**

---

### 5.6 Token-aware Reading UI
**What it is**  
A reading UI that makes token usage visible where premium actions occur.

**What it adds**  
- Token balance near the tier label
- Small price badges near token-using actions
- Clearer premium-action feedback

**Why it matters**  
Helps users understand cost and availability without guessing.

---

## 6. Enhancements Backlog — Second Batch

### 6.1 Leftnav Utility Layer
**What it is**  
A more useful left navigation area built around reading shortcuts and return paths.

**What it adds**  
- Return to Last Read
- Continue Current Chapter
- Today’s Progress
- Reading History

**Why it matters**  
Turns left navigation into a functional utility area instead of a simple menu.

---

### 6.2 Reading History Surface
**What it is**  
A lightweight history view for recently opened books, recent sessions, and recent reading activity.

**What it adds**  
- Recent books
- Recent sessions
- Recent reading activity

**Why it matters**  
Makes it easier to re-enter prior reading without relying on memory.

---

### 6.3 Profile Analytics
**What it is**  
A profile area that presents reading progress in a motivational, readable way.

**What it adds**  
- Pages read
- Minutes read
- Books in progress
- Chapters finished
- Consistency-oriented metrics

**Why it matters**  
Helps the user see momentum and improvement over time.

---

### 6.4 Time-to-finish Forecasting
**What it is**  
An estimate of how long the current chapter or remaining pages will take based on the user’s pace.

**What it adds**  
- Chapter time estimate
- Remaining-reading estimate
- Pace-based decision support

**Why it matters**  
Helps users decide whether to continue now or come back later.

---

### 6.5 Live In-reading Milestones
**What it is**  
Subtle progress cues shown during reading.

**What it adds**  
- Pages completed this sitting
- Chapter percentage
- Pages remaining

**Why it matters**  
Reinforces progress without becoming distracting or game-like.

---

### 6.6 Settings Expansion
**What it is**  
A fuller settings surface with practical reading controls instead of sparse or placeholder areas.

**What it adds**  
- Preview rail visibility
- Timer defaults
- Reading density
- Reduced motion
- Always resume last book

**Why it matters**  
Makes settings feel useful and complete for everyday reading.

---

## 7. Enhancements Backlog — Third Batch

### 7.1 Smart Library Lanes
**What it is**  
A more organized library built around purposeful reading lanes.

**What it adds**  
- Continue Reading
- Recently Imported
- Started Not Finished
- Recently Finished

**Why it matters**  
Makes the library easier to scan and act on.

---

### 7.2 Chapter-level Momentum Surfaces
**What it is**  
Visual chapter-progress elements that make larger readings feel more manageable.

**What it adds**  
- Pages left in chapter
- Progress rings
- Chapter completion moments

**Why it matters**  
Breaks long reading into clearer, more approachable chunks.

---

### 7.3 Reading History Enhancements
**What it is**  
A stronger version of the history view with better browsing tools once the base history surface exists.

**What it adds**  
- Better filtering
- Better grouping
- More useful visual markers

**Why it matters**  
Improves long-term browsing of older reading activity.

---

### 7.4 End-of-session Win Screen
**What it is**  
A concise session-end summary that reflects what the user accomplished.

**What it adds**  
- Pages completed
- Minutes read
- Clear next step

**Why it matters**  
Ends a session with a simple sense of progress and continuation.

---

### 7.5 Ambience and Focus Presets
**What it is**  
Simple presets that quickly adjust the reading atmosphere for different moods.

**What it adds**  
- Quiet night preset
- Deep focus preset
- Faster personalization path

**Why it matters**  
Lets users shape the reading environment without manual setup.

---

## Supporting Backlog Details Relevant to Shell/UI

These are not separate batches, but they do imply additional visible objects, labels, controls, or organizational needs in the shell.

### Settings Additions
**Potential UI objects**  
- Preview rail visibility toggle
- Auto-focus consolidation box
- Reading density control
- Timer defaults control
- Ambience defaults control
- Reduced motion toggle
- Always resume last book toggle

**Why they matter**  
These settings affect how large and complex the settings surface becomes.

---

### Profile Analytics Additions
**Potential UI objects**  
- Pages read today / this week
- Minutes read today / this week
- Chapters finished
- Books in progress
- Average session length
- Best reading day
- Consistency calendar

**Why they matter**  
These metrics influence profile layout, analytics cards, summaries, and visual hierarchy.

---

### Token UI Additions
**Potential UI objects**  
- Token balance beside tier tag
- Token badges beside import and TTS actions
- Token usage analytics
- Low-token warning states

**Why they matter**  
These elements introduce counters, badges, warning states, and premium-usage messaging into the shell.
