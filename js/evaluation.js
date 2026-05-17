// Split from original app.js during role-based phase-1 restructure.
// File: evaluation.js
// Note: This is still global-script architecture (no bundler/modules required).

  // 🧭 COMPASS & SUBMISSION LOGIC
  // ===================================
  
  function checkCompassUnlock() {
    // UX rule:
    // - Allow AI feedback page-by-page (show AI button once that page has text)
    // - Do NOT allow compass rating until ALL pages have at least 1 character AND no textarea is focused
    const allHaveText = pageData.every(p => p.isSandstone || p.charCount > 0);
    const noTextareaFocused = document.activeElement.tagName !== 'TEXTAREA';

    const allPages = document.querySelectorAll(".page");
    allPages.forEach((pageEl, i) => {
      const aiBtn = pageEl.querySelector(".ai-btn");
      if (aiBtn) {
        const canShowAI = !pageData[i]?.isSandstone && (pageData[i]?.charCount || 0) > 0;
        aiBtn.style.display = canShowAI ? 'block' : 'none';
      }
    });

    // Track phase so navigation can behave differently.
    evaluationPhase = !!(allHaveText && noTextareaFocused);

    if (!evaluationPhase) return;

    let anyUnlocked = false;
    allPages.forEach((pageEl, i) => {
      const starsDiv = pageEl.querySelector(".stars");
      const evalSection = pageEl.querySelector(".evaluation-section");
      if (!pageData[i].isSandstone && starsDiv) {
        starsDiv.classList.remove("locked");
        if (!starsDiv.classList.contains('rated') && evalSection) {
          evalSection.classList.add('ready');
          anyUnlocked = true;
        }

        // If this page already has an AI response rendered, enabling compasses
        // should also enable the "Use This Rating" button.
        updateUseRatingButtons(i);
      }
    });

    if (anyUnlocked && !allSoundsMuted) {
      evaluateSound.currentTime = 0;
      if (window.playSfx) window.playSfx(evaluateSound, { restart: true, loop: false, retries: 2, delay: 120 });
      else evaluateSound.play();
    }
  }

  // "Use This Rating" should only be clickable once the page is in Evaluation stage.
  function canUseAIRating(pageIndex) {
    const pageEl = document.querySelectorAll('.page')[pageIndex];
    if (!pageEl) return false;
    if (pageData?.[pageIndex]?.isSandstone) return false;
    const starsDiv = pageEl.querySelector('.evaluation-section .stars');
    const evalSection = pageEl.querySelector('.evaluation-section');
    if (!starsDiv || !evalSection) return false;
    return !starsDiv.classList.contains('locked') && evalSection.classList.contains('ready');
  }

  function updateUseRatingButtons(pageIndex) {
    const feedbackDiv = document.querySelector(`.ai-feedback[data-page="${pageIndex}"]`);
    if (!feedbackDiv) return;
    const useBtn = feedbackDiv.querySelector('.use-rating-btn');
    if (!useBtn) return;
    const rating = Number(useBtn.getAttribute('data-rating') || '0');
    const enabled = rating > 0 && canUseAIRating(pageIndex);
    useBtn.disabled = !enabled;
    useBtn.title = enabled ? '' : 'Locked until Evaluation stage.';
  }

  function scrollToTop() {
    const firstPage = document.querySelector('.page');
    if (firstPage) {
      firstPage.scrollIntoView({ behavior: 'instant', block: 'start' });
    }
  }

  // Activate a page card without a textarea focus — plays the page turn sound and
  // applies the .page-active class. Used by goToNext in Reading mode.
  function activatePageCard(pageEl, pageIndex) {
    if (!pageEl) return;
    pageEl.classList.add('page-active');

    // Reading-mode Next/advance is explicit page-change intent. When narration
    // has just been stopped, make the navigated-to page the new runtime-active
    // page immediately so Play resumes from this card instead of snapping back
    // to the previously spoken page.
    lastFocusedPageIndex = pageIndex;
    try { currentPageIndex = pageIndex; } catch (_) {}
    try {
      if (typeof setReadingTarget === 'function' && typeof window.getReadingTargetContext === 'function') {
        const ctx = window.getReadingTargetContext();
        setReadingTarget({ sourceType: ctx.sourceType, bookId: ctx.bookId, chapterIndex: ctx.chapterIndex, pageIndex });
      }
    } catch (_) {}
    try {
      if (!allSoundsMuted) {
        pageTurnSound.currentTime = 0;
        pageTurnSound.play();
      }
    } catch (_) {}
    // Remove the active class after a short beat so it doesn't linger indefinitely.
    setTimeout(() => pageEl.classList.remove('page-active'), 600);
  }

  function goToNext(currentIndex) {
    // Navigation rules:
    // - Consolidation phase: focus the next editable textarea.
    // - Evaluation phase: DO NOT focus the textarea; scroll to the next page block instead.
    // currentIndex is the page index the user is "on" (0-based). Use -1 to start from the beginning.

    // Reading-mode navigation must go through the runtime-owned page-session
    // transition path. This preserves active narration onto the next page, keeps
    // silent Next silent, and avoids the old stop-then-restart/autoplay route.
    if (appMode === 'reading') {
      try {
        if (typeof ttsAdvancePageSession === 'function') {
          const moved = !!ttsAdvancePageSession(1);
          if (moved) return;
        }
      } catch (_) {}
    }

    // If no explicit index was provided, try to advance from the page the user was interacting with.
    if (typeof currentIndex !== "number") {
      currentIndex = lastFocusedPageIndex;
      if (currentIndex < 0) currentIndex = inferCurrentPageIndex();
    }

    // Keep phase flag up to date (especially when called from buttons).
    checkCompassUnlock();

    const pageEls = document.querySelectorAll('.page');

    if (evaluationPhase) {
      // Scroll to the next page, or wrap to top.
      const nextIdx = (pageEls.length > 0) ? ((currentIndex + 1) % pageEls.length) : 0;
      const target = pageEls[nextIdx];
      if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } else {
        scrollToTop();
      }
      // Ensure no textarea gets auto-focused.
      const active = document.activeElement;
      if (active && active.tagName === 'TEXTAREA') active.blur();
      return;
    }

    // Consolidation phase: scroll to the next page, then focus its textarea
    // (textarea focus is skipped in reading mode, which has no consolidation fields).
    for (let j = currentIndex + 1; j < pageEls.length; j++) {
      const pageEl = pageEls[j];
      if (!pageEl) continue;
      const ta = pageEl.querySelector('textarea');
      const isEditable = ta && !ta.readOnly && !ta.disabled;
      // In reading mode there is no textarea — advance to the next page regardless.
      if (appMode === 'reading' || isEditable) {
        if (appMode === 'reading' && typeof window.__rcScrollReadingPageIntoView === 'function') {
          window.__rcScrollReadingPageIntoView(pageEl, { behavior: 'smooth', reason: 'reading-next-fallback' });
        } else {
          pageEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
        if (appMode === 'reading') {
          activatePageCard(pageEl, j);
        }
        if (isEditable) ta.focus();
        return;
      }
    }

    // none remain → force unlock sequence
    const active = document.activeElement;
    if (active && active.tagName === "TEXTAREA") active.blur();
    checkCompassUnlock();
    scrollToTop();
  }

  // Global keyboard navigation:
  // - Enter (when not in a textarea): go to next consolidation box
  // - Esc (when in a textarea): unfocus textarea
  document.addEventListener("keydown", (e) => {
    // Esc handled per-textarea; this is a backup for cases where focus is on something else.
    if (e.key === "Escape") {
      const active = document.activeElement;
      if (active && active.tagName === "TEXTAREA") {
        e.preventDefault();
        active.blur();
      }
      return;
    }

    if (e.key !== "Enter" || e.shiftKey) return;

    const active = document.activeElement;
    if (active && active.tagName === "TEXTAREA") return;

    e.preventDefault();

    // If user has never focused a page yet, treat as start
    const startIndex = (lastFocusedPageIndex === -1) ? -1 : lastFocusedPageIndex;
    goToNext(startIndex);

  });



  async function evaluatePageWithAI(pageIndex) {
    const aiBtn = document.querySelector(`.ai-btn[data-page="${pageIndex}"]`);
    const feedbackDiv = document.querySelector(`.ai-feedback[data-page="${pageIndex}"]`);
    if (!aiBtn || !feedbackDiv) return;

    const policyApi = window.rcPolicy || {};
    if (typeof policyApi.canUseAiEvaluate === 'function' && !policyApi.canUseAiEvaluate()) {
      alert('AI evaluation is not available on the active plan.');
      return;
    }

    if (appMode === 'research') {
      alert('Research Mode evaluation is coming soon!\n\nIn this mode, your consolidations will be evaluated for consistency with your research thesis rather than general comprehension.');
      return;
    }
    // Toggle if already open
    if (feedbackDiv.style.display === 'block') {
      feedbackDiv.style.display = 'none';
      aiBtn.textContent = '▼ AI Evaluate';
      if (pageData?.[pageIndex]) {
        pageData[pageIndex].aiExpanded = false;
        schedulePersistSession();
      }
      return;
    }

    aiBtn.textContent = '⏳ Loading...';
    aiBtn.classList.add('loading');
    feedbackDiv.style.display = 'block';
    feedbackDiv.innerHTML = '<div style="text-align: center; opacity: 0.6;">Analyzing...</div>';

    if (pageData?.[pageIndex]) {
      pageData[pageIndex].aiExpanded = true;
      schedulePersistSession();
    }

    const page = pageData[pageIndex];
    const pageElement = document.querySelectorAll('.page')[pageIndex];
    const passageText = pageElement.querySelector('.page-text').textContent;
    const userText = page?.consolidation || "";

    // Diagnostics flag (URL): when enabled, the API returns extra debug fields that are
    // stored only in lastAIDiagnostics (never rendered into the normal UI).
    const debugEnabled = isDebugEnabledFromUrl();

    const MAX_DEBUG_CHARS = 900; // small on purpose
    const pageTextForRequest = passageText; // never alter grading input for debugging

    // Prefer anchor-owned better consolidation (from page state or cache)
    // so /api/ai?action=evaluate can focus on grading instead of re-summarizing.
    // Use the same stable hash as /api/ai?action=anchors so we can pull the anchor pack from memory.
    // Anchors compute pageHash via: await sha256HexBrowser(pageText)
    const pageHashForEval = (page && page.pageHash)
      ? page.pageHash
      : await sha256HexBrowser(pageTextForRequest);
    // Anchor packs are cached in localStorage (see readAnchorsFromCache/writeAnchorsToCache).
    // Use that canonical cache here rather than a separate in-memory map.
    const cachedAnchorPack = readAnchorsFromCache(pageHashForEval);

    const requestPayload = {
      pageText: pageTextForRequest,
      userText,
      // Optional context coming from /api/ai?action=anchors. This is stable, page-level, and not user-dependent.
      // Evaluate generates Better consolidation itself; do not pass any page-level better consolidation from anchors.
      anchors: Array.isArray(page?.anchors) ? page.anchors : undefined,
      betterCharLimit: goalCharCount,
      bulletMaxChars: 110,
      debug: debugEnabled ? "1" : undefined
    };
    // Keep diagnostics readable without changing the actual request sent to the API.
    const diagRequest = (() => {
      if (!debugEnabled) return requestPayload;
      try {
        const clone = JSON.parse(JSON.stringify(requestPayload));
        const max = 2000; // cap stored text only (not sent)
        if (typeof clone.pageText === 'string' && clone.pageText.length > max) {
          clone.pageText = clone.pageText.slice(0, max) + `… (truncated, ${clone.pageText.length} chars total)`;
        }
        if (typeof clone.userText === 'string' && clone.userText.length > max) {
          clone.userText = clone.userText.slice(0, max) + `… (truncated, ${clone.userText.length} chars total)`;
        }
        return clone;
      } catch (_) {
        return requestPayload;
      }
    })();


    // remove undefined keys (optional)
    if (!requestPayload.debug) delete requestPayload.debug;

    // Pre-flight usage check before cloud evaluation call.
    // Pass 3: server verdict gates the action; client counter is display-only.
    if (window.rcUsage && typeof window.rcUsage.check === 'function') {
      try {
        const verdict = await window.rcUsage.check('evaluate');
        if (!verdict.allowed) {
          throw new Error('Usage limit reached. Upgrade your plan to continue using AI evaluation.');
        }
      } catch (usageErr) {
        // Only re-throw if it was the usage-limit block, not a network error.
        if (usageErr.message && usageErr.message.includes('Usage limit')) throw usageErr;
        // Server unreachable: proceed (safe degraded behavior).
      }
    }

    try {
      const response = await fetch(apiUrl("/api/ai?action=evaluate"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestPayload)
      });

      const rawText = await response.text();
      if (!response.ok) {
        lastAIDiagnostics = {
          kind: 'evaluate',
          pageIndex,
          status: response.status,
          request: diagRequest,
          responseText: rawText,
          at: new Date().toISOString()
        };
        throw new Error(rawText);
      }
      // Spend 2 tokens for AI evaluation (display/diagnostics tracking only).
      try { if (window.rcUsage && typeof window.rcUsage.spend === 'function') window.rcUsage.spend('evaluate'); else if (typeof tokenSpend === 'function') tokenSpend('evaluate'); } catch(_) {}

      const data = JSON.parse(rawText || "{}");
      lastAIDiagnostics = {
        kind: 'evaluate',
        pageIndex,
        status: response.status,
        request: diagRequest,
        responseText: rawText,
        // If the API returned debug info, keep it out of the normal UI and only
        // expose it via the diagnostics panel.
        debug: data && data.debug ? data.debug : undefined,
        at: new Date().toISOString()
      };
      // Passage highlighting is now owned by anchors; evaluation is for rating + analysis only.
      // Evaluation should not clear existing highlights (anchors own passage highlighting).
      // IMPORTANT: pass the feedbackDiv so we can render even if the page is mid-render.
      displayAIFeedback(pageIndex, data.feedback || "", null, feedbackDiv);
      // Flush immediately so reloads never miss AI feedback.
      try { persistSessionNow(); } catch (_) {}

      aiBtn.textContent = '▲ AI Evaluate';
      aiBtn.classList.remove('loading');
    } catch (error) {
      console.error('AI evaluation error:', error);
      if (!lastAIDiagnostics) {
        lastAIDiagnostics = {
          kind: 'evaluate',
          pageIndex,
          status: 0,
          request: diagRequest,
          responseText: String(error?.message || error || ''),
          at: new Date().toISOString()
        };
      }
      const diag = lastAIDiagnostics || null;
      const status = diag && typeof diag.status === 'number' ? diag.status : 0;
      const msg = String(error?.message || error || '').slice(0, 240);
      feedbackDiv.innerHTML =
        `<div style="color:#8B2500;">
          <div><b>AI Evaluate failed</b>${status ? ` (HTTP ${status})` : ''}.</div>
          <div style="opacity:0.85; font-size:13px; margin-top:6px;">${escapeHtml(msg || 'Unknown error')}</div>
          <div style="opacity:0.7; font-size:12px; margin-top:6px;">Tip: open DevTools → Network and look for <code>/api/ai?action=evaluate</code>. (If you're on GitHub Pages, set <code>?api=</code> to your Vercel deployment.)</div>
        </div>`;
      aiBtn.textContent = '▼ AI Evaluate';
      aiBtn.classList.remove('loading');

      if (pageData?.[pageIndex]) {
        pageData[pageIndex].aiExpanded = false;
        schedulePersistSession();
      }
    }
  }

  function displayAIFeedback(pageIndex, feedback, highlightSnippets = null, feedbackDivOverride = null) {
    // If called during render, the feedback container may not yet be in the DOM.
    // Prefer the passed element, otherwise fall back to the canonical selector.
    const feedbackDiv = feedbackDivOverride || document.querySelector(`.ai-feedback[data-page="${pageIndex}"]`);
    if (!feedbackDiv) return;

    // Persist raw feedback so Final Summary can reuse it later.
    if (pageData?.[pageIndex]) {
      pageData[pageIndex].aiFeedbackRaw = String(feedback || "");
      pageData[pageIndex].aiAt = Date.now();
      // If we are displaying feedback, we consider the panel open.
      // (Toggling closed is handled in evaluatePageWithAI.)
      if (pageData[pageIndex].aiExpanded !== false) pageData[pageIndex].aiExpanded = true;
      if (Array.isArray(highlightSnippets)) {
        pageData[pageIndex].highlightSnippets = highlightSnippets
          .map(s => String(s || '').trim())
          .filter(Boolean);
      }
      schedulePersistSession();
    }

    // Apply yellow highlights ONLY if explicitly provided.
    // Passing null/undefined preserves existing highlights (anchors).
    if (Array.isArray(highlightSnippets)) {
      applyHighlightSnippetsToPage(pageIndex, pageData?.[pageIndex]?.highlightSnippets || []);
    }

    // Robust parsing:
    // - Works with \n or \r\n
    // - Tolerates extra lines (rare model drift)
    // - Accepts quoted or unquoted "better consolidation" line
    // - Accepts label variants: "Better consolidation:", "Example of Strong Consolidation:", "**Strong Consolidation:**"
    const rawLines = String(feedback || "")
      .split(/\r?\n/)
      .map(l => l.trim())
      .filter(l => l.length > 0);

    // 1) Rating (🧭🧭⚪⚪⚪ (2/5))
    const ratingLine = rawLines.find(l => /[🧭⚪]+\s*\(\d\/5\)/.test(l)) || "";
    const ratingMatch = ratingLine.match(/([🧭⚪]+)\s*\((\d)\/5\)/);
    const rating = ratingMatch ? parseInt(ratingMatch[2], 10) : 0;

    // 2) Analysis: first non-rating line after the rating line
    let analysis = "";
    const ratingIdx = rawLines.indexOf(ratingLine);
    if (ratingIdx >= 0) {
      analysis = rawLines.slice(ratingIdx + 1).find(l => !/better consolidation/i.test(l) && !/strong consolidation/i.test(l)) || "";
    } else {
      analysis = rawLines[1] || "";
    }

    // 3) Better consolidation: locate label, then take remaining lines
    const labelIdx = rawLines.findIndex(l =>
      /^better consolidation\s*:?\s*$/i.test(l) ||
      /^example of strong consolidation\s*:?\s*$/i.test(l) ||
      /^\*\*strong consolidation:\*\*\s*$/i.test(l) ||
      /^strong consolidation\s*:?\s*$/i.test(l)
    );

    let betterExample = "";
    if (labelIdx >= 0) {
      const after = rawLines.slice(labelIdx + 1);
      if (after.length) betterExample = after.join(" ");

      // Strip optional surrounding quotes
      betterExample = betterExample.replace(/^"+/, "").replace(/"+$/, "").trim();

      // Strip the optional trailing "This consolidation..." sentence if included
      betterExample = betterExample.replace(/\s*This consolidation\b.*$/i, "").trim();
    } else if (rawLines.length >= 4) {
      // Back-compat: exactly 4 lines
      betterExample = rawLines[3].replace(/^"+/, "").replace(/"+$/, "").trim();
    }

    // Store parsed strings for optional features (e.g., TTS)
    if (pageData?.[pageIndex]) {
      pageData[pageIndex].aiAnalysisText = analysis || "";
      pageData[pageIndex].aiBetterText = betterExample || "";
      schedulePersistSession();
    }

    // Build HTML
    let html = '';

    if (ratingMatch) {
      html += `<div class="ai-rating">${ratingMatch[1]} <span class="ai-score">(${rating}/5)</span></div>`;
    }

    if (analysis) {
      html += `<div class="ai-analysis">${analysis}</div>`;
    }

    if (betterExample) {
      const leadIns = [
        "Here's another way to approach this…",
        "Try phrasing it like this →",
        "Let's take it a step further…",
        "Here's how to sharpen it…",
      ];
      const leadIn = leadIns[pageIndex % leadIns.length];
      html += `<div class="better-example">
        <div class="better-header">
          <div class="better-label">${leadIn}</div>
          <button type="button" class="top-btn tts-btn tts-better" data-tts="better" data-page="${pageIndex}">🔊 Read</button>
        </div>
        <div class="better-text">"${betterExample}"</div>
      </div>`;
    }

    // Actions: "Use This Rating" is disabled until the page reaches Evaluation stage.
    const useDisabled = !(rating > 0 && canUseAIRating(pageIndex));
    html += `<div class="ai-actions">`
    html += `<button class="use-rating-btn" data-rating="${rating}" ${useDisabled ? 'disabled' : ''} onclick="applyAIRating(${pageIndex}, ${rating})">Use This Rating (${rating}/5)</button>`;
    html += `<button class="next-after-ai-btn" onclick="goToNext(${pageIndex})">Next Page →</button>`;
    html += `</div>`;
    feedbackDiv.innerHTML = html;

    // TTS: Read feedback statement (analysis), lead-in phrase, then better consolidation
    const ttsBetterBtn = feedbackDiv.querySelector('.tts-btn[data-tts="better"]');
    if (ttsBetterBtn) {
      ttsBetterBtn.addEventListener("click", () => {
        const a = pageData?.[pageIndex]?.aiAnalysisText || analysis || "";
        const leadIns = [
          "Here's another way to approach this.",
          "Try phrasing it like this.",
          "Let's take it a step further.",
          "Here's how to sharpen it.",
        ];
        const leadIn = leadIns[pageIndex % leadIns.length];
        const b = pageData?.[pageIndex]?.aiBetterText || betterExample || "";
        const parts = [a, leadIn, b].filter(Boolean);
        ttsSpeakQueue(`better-${pageIndex}`, parts);
      });
    }

    // In case the compass unlock happens after AI renders, keep button state synced.
    updateUseRatingButtons(pageIndex);
  }


  function applyAIRating(pageIndex, rating) {
    const starsDiv = document.querySelector(`.stars[data-page="${pageIndex}"]`);
    if (!starsDiv) return;
    
    const stars = starsDiv.querySelectorAll(".star");
    setRating(pageIndex, rating, stars);

    // UX: after accepting the AI rating, advance to the next page.
    // Exception: on the final page, do NOT wrap to the first page (keep the user in place).
    // (The dedicated Next button handles wrap-to-first.)
    const lastIndex = pageData.length - 1;
    if (pageIndex < lastIndex) {
      // In Evaluation phase this will scroll without focusing the textarea.
      goToNext(pageIndex);
    }
  }

  function setRating(pageIndex, value, stars) {
    pageData[pageIndex].rating = value;
    pageData[pageIndex].editedAt = Date.now();
    // Persist immediately-ish so refresh doesn't wipe compass work.
    schedulePersistSession();
    
    // Play compass click sound
    if (!allSoundsMuted) {
      compassSound.currentTime = 0;
      compassSound.play();
    }
    
    // Mark this compass group as rated (stops animation)
    const starsDiv = stars[0].closest('.stars');
    starsDiv.classList.add('rated');
    
    // Stop label glow animation
    const evalSection = starsDiv.closest('.evaluation-section');
    evalSection.classList.remove('ready');
    
    // Fill stars up to the clicked value
    stars.forEach((star, i) => {
      if (i < value) {
        star.classList.add("filled");
      } else {
        star.classList.remove("filled");
      }
    });
    
    checkSubmitButton();
  }

  function checkSubmitButton() {
    
    // Enable submit when all non-sandstone pages have been rated
    const nonSandstonePages = pageData.filter(p => !p.isSandstone);
    
    const btn = document.getElementById("submitBtn");
    if (!btn) return;

    if (!pageData.length) { btn.disabled = true; return; }

    // If all pages are sandstone, enable immediately
    if (nonSandstonePages.length === 0 && pageData.length > 0) {
      document.getElementById("submitBtn").disabled = false;
      return;
    }
    
    // Otherwise check if all non-sandstone pages are rated
    const allRated = nonSandstonePages.every(p => p.rating > 0);
    document.getElementById("submitBtn").disabled = !allRated;
  }

  // ===================================
  // 📊 EVALUATION & TIER SYSTEM
  // ===================================
  
  function calculateScores() {
    const totalPages = pageData.length;
    if (totalPages === 0) return null;
    
    // 1. Comprehension Score (55 pts) - compass self-evaluation
    const nonSandstonePages = pageData.filter(p => !p.isSandstone);
    let comprehensionScore = 0;
    if (nonSandstonePages.length > 0) {
      const totalRating = nonSandstonePages.reduce((sum, p) => sum + p.rating, 0);
      const avgRating = totalRating / nonSandstonePages.length;
      comprehensionScore = (avgRating / 5) * WEIGHT_COMPREHENSION;
    }
    
    // 2. Discipline Score (25 pts) - completed on time with gradient penalty for insufficient length
    // Full credit if >= (1 - COMPRESSION_TOLERANCE) of goal, proportional penalty if below
    const minChars = Math.floor(goalCharCount * (1 - COMPRESSION_TOLERANCE));
    let disciplineScore = 0;
    
    pageData.forEach(p => {
      if (!p.completedOnTime) {
        // Sandstoned: no points
        disciplineScore += 0;
      } else if (p.charCount >= minChars) {
        // Met minimum-length threshold: full points
        disciplineScore += WEIGHT_DISCIPLINE;
      } else {
        // Below threshold: proportional credit (0 to minChars range)
        disciplineScore += (p.charCount / minChars) * WEIGHT_DISCIPLINE;
      }
    });
    disciplineScore = disciplineScore / totalPages;
    
    // 3. Compression Score (20 pts) - character count sweet spot
    let compressionScore = 0;
    pageData.forEach(p => {
      const chars = p.charCount;
      const goal = goalCharCount;
      const sweetSpotMin = Math.floor(goal * (1 - COMPRESSION_TOLERANCE));
      const sweetSpotMax = Math.ceil(goal * (1 + COMPRESSION_TOLERANCE));
      
      if (chars < sweetSpotMin) {
        // Under sweet spot: proportional penalty
        compressionScore += (chars / goal) * WEIGHT_COMPRESSION;
      } else if (chars <= sweetSpotMax) {
        // In sweet spot: full points
        compressionScore += WEIGHT_COMPRESSION;
      } else {
        // Over sweet spot: penalty
        const overAmount = chars - sweetSpotMax;
        const penalty = (overAmount / goal) * WEIGHT_COMPRESSION;
        compressionScore += Math.max(0, WEIGHT_COMPRESSION - penalty);
      }
    });
    compressionScore = compressionScore / totalPages;
    
    const totalScore = comprehensionScore + disciplineScore + compressionScore;
    
    return {
      comprehension: Math.round(comprehensionScore * 10) / 10,
      discipline: Math.round(disciplineScore * 10) / 10,
      compression: Math.round(compressionScore * 10) / 10,
      total: Math.round(totalScore * 10) / 10
    };
  }
  
  function getTier(score) {
    for (let tier of TIERS) {
      if (score >= tier.min) return tier;
    }
    return TIERS[TIERS.length - 1]; // Fallback to lowest tier
  }
  
  function submitEvaluation() {
    const btn = document.getElementById("submitBtn");
    btn.disabled = true;

    if (appMode === 'research') {
      alert('Research Mode scoring is coming soon!\n\nFull evaluation against your research thesis will be available in an upcoming update.');
      return;
    }
    // Calculate scores
    const scores = calculateScores();
    if (!scores) {
      alert("No pages to evaluate!");
      btn.disabled = false;
      return;
    }
    
    const tier = getTier(scores.total);
    const advice = getNextTierAdvice(tier.name);
    
    // Calculate session stats
    const totalPages = pageData.length;
    const sandstoned = pageData.filter(p => p.isSandstone).length;
    const avgRating = pageData.filter(p => !p.isSandstone).length > 0
      ? pageData.filter(p => !p.isSandstone).reduce((sum, p) => sum + p.rating, 0) / pageData.filter(p => !p.isSandstone).length
      : 0;
    const avgChars = pageData.reduce((sum, p) => sum + p.charCount, 0) / totalPages;
    
    // Update verdict section
    const verdictSection = document.getElementById("verdictSection");
    verdictSection.innerHTML = `
      <div class="seal">${tier.emoji}</div>
      <div class="tier-name">${tier.name}</div>
      <div class="tier-subtitle">Total Score: ${scores.total}</div>
      
      <div class="score-breakdown">
        <div class="score-item">
          <div class="score-label">Comprehension</div>
          <div class="score-value">${scores.comprehension}</div>
          <div class="score-desc">Self-evaluation</div>
        </div>
        <div class="score-item">
          <div class="score-label">Discipline</div>
          <div class="score-value">${scores.discipline}</div>
          <div class="score-desc">On time + substance</div>
        </div>
        <div class="score-item">
          <div class="score-label">Compression</div>
          <div class="score-value">${scores.compression}</div>
          <div class="score-desc">Concise writing</div>
        </div>
      </div>

      <div class="explanation-section">
        <p><strong>Comprehension (${scores.comprehension}/${WEIGHT_COMPREHENSION}):</strong> Your honest self-assessment of how well you understood the material's core ideas, accuracy, and engagement.</p>
        
        <p><strong>Discipline (${scores.discipline}/${WEIGHT_DISCIPLINE}):</strong> Completed before time runs out. Full credit at ${Math.round((1 - COMPRESSION_TOLERANCE) * 100)}%+ of character goal (${Math.floor(goalCharCount * (1 - COMPRESSION_TOLERANCE))}+ chars). Below that, credit scales proportionally down to zero.</p>
        
        <p><strong>Compression (${scores.compression}/${WEIGHT_COMPRESSION}):</strong> Writing concise summaries that capture meaning without being too brief or verbose. Sweet spot: ${Math.floor(goalCharCount * (1 - COMPRESSION_TOLERANCE))}-${Math.ceil(goalCharCount * (1 + COMPRESSION_TOLERANCE))} characters (${Math.round((1 - COMPRESSION_TOLERANCE) * 100)}-${Math.round((1 + COMPRESSION_TOLERANCE) * 100)}% of goal).</p>
      </div>

      ${advice ? `<div class="next-tier-advice">
        <div class="advice-label">Next Level</div>
        <p>${advice}</p>
      </div>` : ''}

      <div class="session-stats">
        <div class="stat-item">
          <span class="stat-label">Pages completed:</span>
          <span class="stat-value">${totalPages - sandstoned}/${totalPages}</span>
        </div>
        <div class="stat-item">
          <span class="stat-label">Pages sandstoned:</span>
          <span class="stat-value">${sandstoned}/${totalPages}</span>
        </div>
        <div class="stat-item">
          <span class="stat-label">Avg compass rating:</span>
          <span class="stat-value">${avgRating.toFixed(1)}/5</span>
        </div>
        <div class="stat-item">
          <span class="stat-label">Avg characters:</span>
          <span class="stat-value">${Math.round(avgChars)}</span>
        </div>
      </div>

      <div class="final-summary-controls" style="margin-top: 18px; display:flex; gap:10px; justify-content:center; flex-wrap:wrap;">
        <button class="submit-btn" id="finalSummaryBtn" type="button" onclick="generateFinalSummary()">Unlock Final Summary</button>
        <button class="submit-btn" id="printResultsBtn" type="button" onclick="printResults()" style="opacity:0.9;">Print Results</button>
      </div>

      <div id="finalSummaryStatus" style="margin-top:10px; text-align:center; font-size: 14px; opacity:0.8;"></div>
      <div id="finalSummaryOutput" style="margin-top:12px; display:none;"></div>
    `;
    
    // Show verdict with animation
    verdictSection.style.display = "block";
    
    // Play reward sound
    if (!allSoundsMuted) {
      rewardSound.currentTime = 0;
      rewardSound.play();
    }
    
    // Optional: Trigger confetti for Masterful
    if (tier.name === 'Masterful') {
      triggerConfetti();
    }
  }

  // ===================================
  // 🧠 FINAL SUMMARY (CHAPTER CONSOLIDATION)
  // ===================================

  function buildFinalSummaryPagesPayload() {
    // Tiered input:
    // 1) Use stored AI feedback if present for a page.
    // 2) Otherwise fall back to raw page text + user consolidation.
    // This keeps token usage controlled and avoids reprocessing pages that already have feedback.
    return pageData
      .map((p, idx) => {
        const ai = String(p?.aiFeedbackRaw ?? "").trim();
        const pageText = String(p?.text ?? "").trim();
        const userText = String(p?.consolidation ?? "").trim();

        if (ai) return { n: idx + 1, aiFeedback: ai };
        return { n: idx + 1, pageText, userText };
      })
      .filter((p) => {
        const ai = String(p?.aiFeedback ?? "").trim();
        const t = String(p?.pageText ?? "").trim();
        const u = String(p?.userText ?? "").trim();
        return ai || t || u;
      });
  }

  async function generateFinalSummary() {
    const btn = document.getElementById("finalSummaryBtn");
    const status = document.getElementById("finalSummaryStatus");
    const out = document.getElementById("finalSummaryOutput");
    if (!btn || !status || !out) return;

    const pagesPayload = buildFinalSummaryPagesPayload();
    if (!pagesPayload.length) {
      status.textContent = "Insufficient material to summarize.";
      return;
    }

    btn.disabled = true;
    status.textContent = "Generating final summary…";
    out.style.display = "none";
    out.innerHTML = "";

    const requestPayload = { title: "", pages: pagesPayload };

    try {
      const response = await fetch(apiUrl("/api/ai?action=summary"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestPayload)
      });

      const rawText = await response.text();
      if (!response.ok) {
        lastAIDiagnostics = {
          kind: 'summary',
          status: response.status,
          request: diagRequest,
          responseText: rawText,
          at: new Date().toISOString()
        };
        throw new Error(rawText);
      }

      const data = JSON.parse(rawText || "{}");
      lastAIDiagnostics = {
        kind: 'summary',
        status: response.status,
        request: diagRequest,
        responseText: rawText,
        at: new Date().toISOString()
      };
      const summary = String(data?.summary ?? "").trim();
      if (!summary) {
        status.textContent = "No summary returned.";
        btn.disabled = false;
        return;
      }

      status.textContent = "";
      out.style.display = "block";
      out.innerHTML = `
        <div style="white-space:pre-wrap; line-height:1.45; padding:14px; border: 1px solid var(--border); border-radius: 10px; background: rgba(255,255,255,0.04);">
          ${escapeHtml(summary)}
        </div>
      `;
    } catch (err) {
      console.error("Final summary error:", err);
      status.textContent = "Error generating final summary. Check console.";
      btn.disabled = false;
    }
  }
  function printResults() {
    // Simple, stable text print (no UI/CSS parity attempts).
    const verdict = document.getElementById("verdictSection");
    if (!verdict) return;

    const text = verdict.innerText || "";

    const w = window.open("", "_blank", "width=800,height=600");
    if (!w) return;

    w.document.open();
    w.document.write(`
      <!doctype html>
      <html><head><meta charset="utf-8" />
      <title>Reading Results</title>
      <style>
        body { font-family: monospace; padding: 40px; white-space: pre-wrap; line-height: 1.6; }
      </style>
      </head><body>${escapeHtml(text)}</body></html>
    `);
    w.document.close();

    w.focus();
    w.print();
  }

  // escapeHtml() is defined earlier (single canonical helper).
  
  function getNextTierAdvice(currentTier) {
    const advice = {
      'Fragmented': `Focus on writing substantial consolidations (${Math.round((1 - COMPRESSION_TOLERANCE) * 100)}%+ of your character goal) before time runs out. Discipline means both beating the timer AND writing enough to capture the core idea.`,
      'Developing': 'Build consistency by finishing every page on time and within the character goal. Be honest in your self-evaluations to identify gaps.',
      'Competent': 'Capture the main mechanisms and causal relationships in each passage, not just surface-level facts. This depth will raise your comprehension score.',
      'Proficient': 'Perfect your compression hit the sweet spot every time and consistently rate yourself 5/5 when you have truly mastered the material.',
      'Masterful': 'Outstanding work! You have mastered focused reading, honest self-assessment, and concise consolidation. Keep this discipline as you tackle harder material.'
    };
    return advice[currentTier] || '';
  }
  
  function triggerConfetti() {
    const colors = ['#c17d4a', '#8B2500', '#a96939', '#d4af37'];
    for (let i = 0; i < 50; i++) {
      setTimeout(() => {
        const confetti = document.createElement('div');
        confetti.className = 'confetti';
        confetti.style.left = Math.random() * 100 + '%';
        confetti.style.background = colors[Math.floor(Math.random() * colors.length)];
        confetti.style.animationDuration = (Math.random() * 2 + 2) + 's';
        document.body.appendChild(confetti);
        
        setTimeout(() => confetti.remove(), 3000);
      }, i * 30);
    }
  }

  // Initialize optional Book Import UI
  initBookImporter();

  // ===================================
