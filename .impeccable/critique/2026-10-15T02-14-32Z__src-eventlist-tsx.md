---
target: src/EventList.tsx
total_score: 29
max_score: 40
na_heuristics:
p0_count: 0
p1_count: 0
target_identity: "file:/Users/anuntachai/workspaces/side-projects/sks-tennis-club/src/EventList.tsx"
target_fingerprint: "sha256:b41a180e5d34598c77958b5108759963e72ad18f1e7380ca945af24312fa9c60"
target_path: /Users/anuntachai/workspaces/side-projects/sks-tennis-club/src/EventList.tsx
timestamp: 2026-10-15T02-14-32Z
slug: src-eventlist-tsx
closed: true
---
Method: dual-agent (A: /root/design_review · B: /root/detector_evidence)

**EventList.tsx: 29/40 — Good.** The page is calm, understandable, and recognizably SKS. Its biggest opportunity is to bring the member’s next useful event forward on mobile and make refreshed availability more trustworthy. No blocking usability problem was observed.

Reviewed the current local build at 1280×720, 390×844, and 320×740. This is an Operate surface: finding and opening a tennis session should lead the experience.

**Design specificity and overall impression**

The club crest, cream/navy/sage palette, natural Thai wording, date tiles, and personal registration badges feel grounded in this tennis group. The conventional event-list structure suits the task. Preserve that identity; clearer priorities would help more than additional decoration.

The deterministic scan of src/EventList.tsx returned zero findings (exit 0, JSON []). That does not validate usability or accessibility. Manual browser evidence found no horizontal overflow at the three inspected widths and confirmed 44px button heights. No live detector overlay was injected because the browser exposes only read-only JavaScript evaluation.

**Design health**

| Heuristic | Score /4 | Main observation |
|---|---:|---|
| System status | 3 | Initial loading is clear; refresh freshness is not. |
| Real-world language | 4 | Familiar Thai tennis-group terminology. |
| User control | 3 | Explicit actions and return navigation. |
| Consistency | 3 | Cohesive panels, badges, and buttons. |
| Error prevention | 3 | Opening an event does not immediately register someone. |
| Recognition over recall | 3 | Useful event details; repeated action names lose context. |
| Efficiency | 2 | Chronological order helps; longer lists need serial scanning. |
| Minimalist design | 3 | Restrained styling; excessive mobile preamble. |
| Error recovery | 2 | Loaded data can remain stale after the error toast disappears. |
| Contextual help | 3 | Short instructions explain the main tasks. |
| **Total** | **29/40** | **Good** |

**What works**

- Personal registration, remaining places, capacity, and waiting counts answer practical questions without opening every event.
- Upcoming, past, and cancelled events are clearly separated; collapsing cancellations keeps them out of the main path.
- Heading hierarchy, labelled sections, textual statuses, focus styling, and responsive wrapping provide a sound foundation.

**Priority issues**

1. **[P2] Refresh does not leave a trustworthy freshness signal.** After success, there is no confirmation of when the list was updated. After a later failure, old rows remain; App.tsx shows an error toast for six seconds, but stale availability then looks current. Keep the rows, add a concise last-success status, and retain an inline retry notice after failure. See src/EventList.tsx:37 and :138. Suggested command: `$impeccable harden`.

2. **[P2] The mobile introduction delays the useful content.** At 390px wide, the first event begins about 438px down the page; its detail button begins around 576px. The introduction, separate refresh row, section heading, and helper sentence consume substantial space. Meanwhile, “+ เปิดนัด” receives the strongest emphasis. Compact the introduction and move refresh alongside the heading. Confirm participant versus organiser priority before changing button emphasis. See src/EventList.tsx:126 and :153. Suggested command: `$impeccable layout`.

3. **[P2] Repeated event buttons lack destination context.** Every active event is “ดูนัด →”; every past event is “ดูประวัติ →”. Screen-reader users browsing buttons cannot distinguish destinations without finding surrounding text. Add the event title and date to each accessible name while keeping the short visible label. See src/EventList.tsx:107. Suggested command: `$impeccable harden`.

4. **[P2] History has no limit or progressive disclosure.** Every ended event renders a full row. The two-event fixture is manageable, but months of history will require extensive scrolling. Show recent history with an explicit “show more” disclosure, or group it by month. Keep recent payment/result work easy to reach. This is a source-based growth risk, not a reproduced large-data failure. See src/EventList.tsx:174. Suggested command: `$impeccable distill`.

**Cognitive load and emotional journey**

Two checklist weaknesses: mobile visual hierarchy and history disclosure at scale. That is moderate load, with the latter conditional on growth. Single focus, chunking, grouping, sequencing, visible choices, and working-memory demands were acceptable in the small fixture; more than four simultaneous upcoming choices was not tested. Arrival feels familiar and calm, and “คุณลงชื่อแล้ว” reassures. The main emotional valley is uncertainty about whether availability is current after refresh.

**Persona red flags**

- **Jordan, first-timer:** The dominant create action can suggest the wrong starting point for someone who wants to join an existing event.
- **Sam, screen-reader user:** Repeated “ดูนัด” buttons obscure destinations in a buttons list. No full VoiceOver session was performed.
- **Casey, distracted mobile member:** Introductory content consumes roughly half the screen before the first event; interrupted refreshes leave no lasting freshness reassurance.

**Minor observations**

- “นัดที่กำลังจะมาถึง” also includes currently running events. A label such as “นัดที่ยังเปิดอยู่” would better match the not-ended filter.
- “อัปเดตรายชื่อ” suggests refreshing a roster; “อัปเดตนัด” better describes this page.
- The shared account/logout controls are narrow and closely spaced despite being 44px tall. This is outside EventList.tsx and belongs in a separate shell accessibility pass.

**Questions to consider**

1. Which should come first: mobile hierarchy, refresh reassurance, or accessible event buttons?
2. For a follow-up, prefer the three local fixes, or all four including history disclosure?
