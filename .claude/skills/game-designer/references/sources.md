# Sources

Every source behind this skill, with the key used in the other reference files. Read on
2026-11-20 unless noted. "Read" = page or file opened; "Summary" = only search-result summaries
or a directory listing were seen, so treat the idea as weaker. We took ideas and numbers in our
own words; no text, code or art was copied. Licenses are as shown on the source; where none was
shown, it says so.

## Agent skills and prompt packs

| Key | Type | Source | License | Seen | What we took |
|---|---|---|---|---|---|
| donchitos-hud | skill | claude-code-game-studios: `ux-design` skill and `hud-design-guide.md` - https://github.com/donchitos/claude-code-game-studios | MIT | Read | HUD stance first; rule of necessity; always / contextual / on demand / diegetic sort; named zones with max counts and an empty centre; HUD states per context; mobile safe margins (portrait 15% top, landscape 15% sides) |
| gamedev-ui-ux | skill | awesome-gamedev-agent-skills `game-ui-ux` - https://github.com/gamedev-skills/awesome-gamedev-agent-skills | Apache-2.0 | Read | Anchor and container layout; one scaling policy; safe area reapplied on resize; screens as a stack; event-driven HUD; size sweep check |
| gamedev-feel | skill | same repo, `game-feel` | Apache-2.0 | Read | Feedback tiers fired from one call; 2-3 channels to start; ease everything; juice is visual only; return to rest; freezes under 0.15 s; reduce-motion and 3-flash limit |
| roblox-ui-skill | skill | same repo, `roblox-ui` | Apache-2.0 | Read | Touch is a capability, not the input in use; keep bottom actions clear of movement and jump |
| gamedev-proto | skill | same repo, `prototype-fast` | Apache-2.0 | Read | One question per prototype, then keep, kill or retune (informs onboarding tests) |
| edhahn-gd | skill | edhahn/agent-skills `game-designer` - https://github.com/edhahn/agent-skills | MIT | Read | Present 2-3 options with trade-offs; flag scope and risk; quantify where possible (informs SKILL.md section 1) |
| (none) | skill | opusgamelabs/game-creator `game-designer` | Not seen | Summary (raw file 404) | Nothing taken |
| (none) | skill | popey, davila7, sickn33, omer-metin `game-design` (directory listings on skills.sh, tessl, claude-plugins.dev) | Not checked | Summary | Nothing taken; generic GDD and balance content |
| (none) | rules | cursor.directory three.js and r3f rules; PatrickJS/awesome-cursorrules | Various | Summary | Nothing taken; code-syntax rules, not design |

## Platform guides and accessibility

| Key | Type | Source | License | Seen | What we took |
|---|---|---|---|---|---|
| gag | guideline | Game Accessibility Guidelines, full list - https://gameaccessibilityguidelines.com/full-list/ | Not stated on page | Read | Basic / intermediate / advanced items: large spaced targets, no colour or sound alone, text chat with voice, who is speaking, symbol chat, portrait and landscape, settings saved |
| xag-101 | guideline | Xbox Accessibility Guideline 101, text display - https://learn.microsoft.com/en-us/gaming/accessibility/xbox-accessibility-guidelines/101 | Microsoft Learn docs (MicrosoftDocs content is usually CC BY 4.0; not confirmed on page) | Read | 18 px at 1080p PC, 200% scaling, 80-char lines, 1.5 spacing, letter and word spacing |
| xag-102 | guideline | XAG 102, contrast - https://learn.microsoft.com/en-us/gaming/accessibility/xbox-accessibility-guidelines/102 | as above | Read | 4.5:1, 3:1, 7:1; measure against the worst part of a busy background; no colour alone |
| xag-107 | guideline | XAG 107, input (touch) - https://learn.microsoft.com/en-us/gaming/accessibility/xbox-accessibility-guidelines/107 | as above | Read by earlier worker (see android-portrait) | Adjustable size and position of touch targets; alternatives to path gestures; release to activate |
| xag-119 | guideline | XAG 119, communication - https://learn.microsoft.com/en-us/gaming/accessibility/xbox-accessibility-guidelines/119 | as above | Read | Voice and text are not substitutes; speech-to-text, text-to-speech, emoji read by name, privacy reasons for not using voice |
| apple-hig-games | guideline | Apple HIG, game controls and designing for games - https://developer.apple.com/design/human-interface-guidelines/game-controls | Apple terms | Read by earlier worker; my fetch got no body (JS page) | Floating thumbstick where the thumb lands; show and hide controls with play; secondary at top; press states; teach through play; defer requests |
| epic-mobile | guideline | Epic, designing for mobile in Fortnite - https://dev.epicgames.com/documentation/fortnite/designing-for-mobile-in-fortnite | Epic terms | Read | 5-6 active controls; primary in bottom corners, maps and timers top or collapsible; dynamic joysticks; swipe for build selection; 44x44 pt; text under 18 pt hard to read |
| roblox-xplat | guideline | Roblox, cross-platform UI design - https://create.roblox.com/docs/ui/cross-platform-design | Roblox terms | Read | Reserved bottom corners; place buttons relative to jump (0.8x size, 20 px left); contextual prompts |
| android-large-screen | guideline | Android large-screen game quality - https://developer.android.com/games/large-screen/build-large-screen-games and tier 2 page | Android docs (CC BY 2.5 for text) | Read by earlier worker | Reflow for any aspect ratio; hit boxes right after fold and rotate; back closes overlays |
| nng-target | article | NN/g, touch target size - https://www.nngroup.com/articles/touch-target-size/ | NN/g terms | Read by earlier worker | About 1 cm minimum targets |
| nng-response | article | NN/g, response times: the 3 important limits - https://www.nngroup.com/articles/response-times-3-important-limits/ | NN/g terms | Read | 0.1 s, 1 s, 10 s limits and what to show at each |
| chrome-viewport | article | Chrome, viewport resize behaviour - https://developer.chrome.com/blog/viewport-resize-behavior | Chrome docs (CC BY 4.0) | Read by earlier worker | Fixed bottom bars sit under the keyboard by default since Chrome 108; `interactive-widget` |

## Designer articles, talks and write-ups

| Key | Type | Source | License | Seen | What we took |
|---|---|---|---|---|---|
| west-latency | blog | Mick West, "Measuring responsiveness in video games" (2008) - https://www.gamedeveloper.com/design/measuring-responsiveness-in-video-games | Game Developer terms | Read | 3-4 frames (50-67 ms) feels tight; 167 ms+ sluggish; steady response matters |
| stonehouse-ui | blog | Anthony Stonehouse, "User interface design in video games" (2014) - https://www.gamedeveloper.com/design/user-interface-design-in-video-games | Game Developer terms | Read | Diegetic, meta, spatial, non-diegetic; prefer the world when legible |
| fagerholt-beyond | thesis | Fagerholt and Lorentzon, "Beyond the HUD" (Chalmers, 2009) - https://publications.lib.chalmers.se/records/fulltext/111921.pdf | Academic | Summary (via stonehouse-ui) | The two-axis UI model (in fiction? in 3D space?) |
| pvz-tips | talk write-up | George Fan, GDC 2012, 10 tutorial tips (Plants vs. Zombies) - https://www.gamedeveloper.com/design/gdc-2012-10-tutorial-tips-from-i-plants-vs-zombies-i-creator-george-fan | Game Developer terms | Read | Learn by doing; one action once; about 8 words; passive messages; adaptive tips; spread systems out; familiar conventions |
| gow-hud | interview | Zach Bohn on God of War Ragnarok UI, 80.lv (2023) - https://80.lv/articles/a-deep-dive-into-god-of-war-ragnar-k-s-user-interface | 80.lv terms | Read | One message queue, one at a time; interruption rules; hide slots until unlocked; font scaling by category; 1-2 step tutorials, about 7 steps max in menus |
| celeste-forgiveness | blog | Maddy Thorson, "Celeste & Forgiveness" - https://maddymakesgames.com/articles/celeste_and_forgiveness/ | Author's site, no license stated | Read | Coyote time, jump buffer, corner correction, wall jump from 2 px; forgiveness as hidden help |
| juice-talk | talk | Martin Jonasson and Petri Purho, "Juice it or lose it" (GDC Europe 2012) - https://gdcvault.com/play/1016487 | GDC Vault | Summary (Wikipedia "Game feel", roblog.co.uk write-up) | Layer small effects; tweening and easing; the world reacts to the player; sound with weight |
| screenshake-talk | talk | Jan Willem Nijman, "The art of screenshake" (2013) - https://www.gamedeveloper.com/design/vlambeer-co-founder-shares-advice-on-building-better-action-games | Game Developer terms | Read (article about the talk; no transcript found) | About 30 small tweaks layered one at a time |
| juice-critique | talk | Folmer Kelly on resisting over-juicing - https://gamedeveloper.com/design/video-indies-resist-the-urge-to-juice-it-or-lose-it- | Game Developer terms | Summary | Polish can cost immersion; do not over-juice |
| swink | book | Steve Swink, "Game Feel" | Book | Summary (secondary accounts) | Feedback within about 100 ms (weak; cross-checked with nng-response) |
| gmtk-4step | video | Game Maker's Toolkit, Super Mario 3D World four-step level design - https://youtu.be/dBmIkEvEBtA | YouTube | Summary (mcvuk, Nintendo Life); transcript blocked by bot check | Introduce, develop, twist, resolve |
| prime-teach-observe | talk | "Prime, Teach, Observe: Tutorializing Innovative Mechanics" (GDC) - https://gdcvault.com/play/1020131 | GDC Vault | Summary (session page) | Observe players to iterate a tutorial |
| hoober-uxm | article | Steven Hoober, "How do users really hold mobile devices?" (2013) - https://www.uxmatters.com/mt/archives/2013/02/how-do-users-really-hold-mobile-devices.php | UXmatters terms | Summary (and via earlier worker) | 49% one-handed, 36% cradled, 75% thumb, 67% right thumb; Hoober later said the popular thumb-zone chart is wrong, so use zones as hypotheses |
| smashing-onehand | article | Smashing, design mobile apps for one-hand usage (2020) - https://smashingmagazine.com/2020/02/design-mobile-apps-one-hand-usage/ | Smashing terms | Read by earlier worker | Bottom sheets; moving menus to the bottom raised use |

## Social spaces

| Key | Type | Source | License | Seen | What we took |
|---|---|---|---|---|---|
| gather-spatial | docs | Gather, overview of spatial audio and video - https://support.gather.town/hc/en-us/articles/15909782743444 | Gather terms | Read | 5 tiles to start, 2 for full; private areas; quiet mode 1 tile; ghost mode; do not disturb |
| gather-spotlight | docs | Gather spotlight and all-hands pages - https://support.gather.town/hc/en-us/articles/15909798676628 | Gather terms | Summary | Broadcast limits about 100-150 people |
| gather-chat | docs | Gather chat overview - https://support.help.gather.town/articles/6847600389 | Gather terms | Summary | Nearby, meeting and direct chat scopes |
| meta-boundary-press | news | Meta personal boundary coverage: Engadget, PC Gamer, The Drum (2022) - https://www.engadget.com/meta-quest-horizon-worlds-horizon-venues-personal-boundary-harassment-174140461.html | Press | Summary (Meta blog fetch returned no body) | About 2 ft radius, 4 ft apart; default on; avatars can pass; later on for non-friends and adjustable |
| vr-safety-paper | paper | "Building proactive and instant-reactive safety designs ... social VR" - https://arxiv.org/html/2504.05781v1 | arXiv | Summary | Quick toggle for a personal bubble; boundary-aware design |
| emote-chapter | book chapter | Avatar gesture chapter (NCBI Bookshelf NBK513146) - https://www.ncbi.nlm.nih.gov/books/NBK513146 ; UMD thesis on mirrored gestures - https://drum.lib.umd.edu/handle/1903/29648 | Open access | Summary | Emotes as a small shared vocabulary; contagion; gesture as presence |
| workadventure | repo | https://github.com/workadventure/workadventure | Not shown on page | Read (README) | Video bubble on approach; meeting areas |
| office-status | repo doc | officexr `docs/office-status/README.md` | Project | Read | Status, focus, emotes, raised hand already in world |

## officexr project documents

| Key | Source | What we took |
|---|---|---|
| hud-review | `docs/hud-review/README.md` (main) | The 13 faults found, the safe-area fix, the revert, capture method |
| fold-hide | `docs/hud-review/fold-hide.md` (main) | Per-control fold and show rules; phone portrait layout; one panel at a time |
| android-portrait | Earlier research note "Portrait one-handed HUD: best practice" (2026-11-20, rules R1-R18), held outside the repo | Folded into hud-and-ui.md and mobile-controls.md; its own sources: Apple HIG game controls and designing for games, Epic mobile, Android large-screen and tier 2, XAG 107, Roblox cross-platform and mobile input, NN/g touch target, Smashing one-hand, Game Developer "design for thumbs" (https://gamedeveloper.com/design/how-to-design-for-thumbs-in-the-era-of-huge-screens), GameAnalytics mobile vs desktop UI (https://www.gameanalytics.com/blog/mobile-desktop-ui-design), Chrome viewport resize |

## Templates and kits

| Key | Type | Source | License | Seen | What we took |
|---|---|---|---|---|---|
| nipplejs | template | https://github.com/yoannmoinet/nipplejs | MIT | Read (README, LICENSE) | Dynamic, static and semi joystick modes; knob 50% of base; threshold, fade, rest opacity |
| godot-vjoy | template | https://github.com/MarcoFazioRandom/Virtual-Joystick-Godot | MIT (listed) | Read (README) | Fixed, dynamic, following modes; dead zone and clamp zone; touchscreen-only visibility |

See `templates-and-kits.md` for the rest: for nipplejs, Godot virtual joysticks, ecctrl, BVHEcctrl, Viber3D,
Maaack's template, Kenney UI pack, SkyOffice, Meetropolis, Relm, with license and what was read.

## Could not read

- Apple HIG pages and Meta's blog (pages render with script; fetch returned no body).
- Full transcripts of "Juice it or lose it", "The art of screenshake" and GMTK videos (YouTube
  bot check; Amara page needed sign-in; Hugging Face GMTK transcript search returned nothing).
- opusgamelabs `game-designer` SKILL.md (raw path 404).
- No podcast transcript was found; the Game UX Podcast lists one transcript on Metacast, not read.
