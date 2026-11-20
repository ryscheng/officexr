# Templates and kits

Open-source kits that show a pattern worth knowing. We take the pattern only: no code, no art,
no install. License as stated by the project page or license file at the time of reading
(2026-11-20); check again before relying on it. "Read" = README or license file opened;
"Summary" = seen only in search summaries or a directory listing.

| Kit | Pattern it shows | License | Link | Seen |
|---|---|---|---|---|
| nipplejs | Three joystick modes: dynamic (new stick per touch, multitouch), static (preset position), semi (re-use the last stick within a catch distance, default 200 px). Options for size (knob 50% of base), threshold, fade time, rest opacity, axis lock. | MIT | https://github.com/yoannmoinet/nipplejs | Read (README, LICENSE) |
| Virtual Joystick for Godot (MarcoFazioRandom) | Fixed, dynamic and following modes; dead zone and clamp zone as a share of the base; "touchscreen only" visibility; the parent area bounds where a dynamic stick can appear. | MIT (listed) | https://github.com/MarcoFazioRandom/Virtual-Joystick-Godot | Read (README) |
| Virtual Joystick Plus / DX (Godot asset library) | Same three modes; follow mode moves the base with the finger at max radius. | MIT (listed) | https://godotengine.org/asset-library/asset/5256 | Summary |
| ecctrl (pmndrs) | Physics character controller for react-three-fiber and Rapier, with a built-in touch joystick placed outside the canvas. Closest stack match to officexr (r3f, Rapier-style physics). | MIT | https://github.com/pmndrs/ecctrl | Read (LICENSE), features from summary |
| BVHEcctrl (pmndrs) | Same controller without a physics engine, using mesh BVH collision. | MIT (listed) | https://github.com/pmndrs/BVHEcctrl | Summary |
| Viber3D | r3f + three.js 3D browser game starter on an ECS (Koota); shows a data-driven game state apart from rendering, like officexr's SDK split. | MIT | https://github.com/instructa/viber3d | Read (README) |
| Maaack's Godot Game Template | Main, options, pause and credits menus; options saved between runs; one shared option control for every setting; overlay menus as a stack. | MIT (listed) | https://github.com/Maaack/Godot-Game-Template | Read (README) |
| Kenney UI Pack | A consistent UI sprite set (buttons, panels, sliders) in several colours: shows how few shapes a whole HUD needs. | CC0 | https://www.kenney.nl/assets/ui-pack | Summary |
| WorkAdventure | 2D virtual office: video bubble when avatars meet, meeting areas, map-defined zones; desktop and mobile. | Not confirmed (repo page did not show it) | https://github.com/workadventure/workadventure | Read (README) |
| SkyOffice | 2D virtual office (Phaser + React + Colyseus) with proximity video. | MIT (listed) | https://github.com/kevinshen56714/SkyOffice | Summary |
| Meetropolis | Open-source virtual office with proximity audio and video in a 2D world. | AGPL-3.0 (listed) | https://github.com/lass-machen/meetropolis | Summary |
| Relm | 3D spatial platform for meeting and working, self-hostable. | AGPL (listed) | https://github.com/relm-us/relm | Summary |
| Gather (product, not open source) | Spatial audio by tiles (5 to start, 2 for full), private areas, quiet mode, spotlight. | Proprietary; docs read for behaviour | https://support.gather.town/hc/en-us/articles/15909782743444 | Read |

## Engine UI guidance with patterns (not kits)

| Source | Pattern | License |
|---|---|---|
| Roblox cross-platform UI docs | Reserved bottom corners for default movement and jump; place custom buttons relative to the jump button; contextual proximity prompts. | Roblox site terms |
| Epic, designing for mobile in Fortnite | 5-6 active controls; dynamic joysticks; swipe for quick selection in build modes; 44 pt minimum. | Epic docs terms |
| Godot multiple resolutions docs (via gamedev-skills `game-ui-ux`) | Anchors and containers, one scaling policy, safe-area insets reapplied on resize. | CC BY 3.0 (Godot docs; not re-checked) |

## Not found

- An open-source three.js or r3f virtual office with proximity voice and a mobile HUD. The
  closest are 2D (WorkAdventure, SkyOffice, Meetropolis) or not office-like (Claw3D, chat3D).
- An open-source HUD kit for the web with a tested safe-area and touch-target layout. The repo's
  own `hud-layout.spec.ts` is the best checker we have.
