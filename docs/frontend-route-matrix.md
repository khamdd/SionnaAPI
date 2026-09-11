# Frontend Route Compatibility Matrix

Status: Phase 0 baseline  
Recorded: 2026-09-11

The current frontend uses `window.history` and internal route normalization. This
matrix is the parity contract for splitting `App.jsx` or migrating routing in a
separate task.

## Route Inventory

| Route | Requires auth | Requires work scene | Navigation placement | Expected page |
| --- | --- | --- | --- | --- |
| `/` | Yes | No | None | Normalizes to `/scenes` |
| `/scenes` | Yes | No | Username menu/change-scene flow | Scene selection and management |
| `/choose-scene` | Yes | No | Create new scene action | Full-page scene chooser |
| `/network` | Yes | Yes | Planning tools | Network Coverage |
| `/network/optimization` | Yes | Yes | Opened from Network Coverage | Optimization; Network nav remains active |
| `/configurations` | Yes | Yes | Planning tools | Network Configurations |
| `/profiles` | Yes | Yes | Planning tools | Simulation Profiles |
| `/coverage` | Yes | Yes | Planning tools | Coverage Map |
| `/rsrp` | Yes | Yes | Planning tools | RSRP Simulation |
| `/sinr` | Yes | Yes | Planning tools | SINR |
| `/throughput` | Yes | Yes | Planning tools | Throughput Comparison |
| `/queue` | Yes | Yes | Results | Simulation Queue |
| `/history` | Yes | Yes | Results | Saved Results scoped to the work scene |
| Any unknown path | Yes | No | None | Normalizes to `/scenes` |

## Session and Navigation Matrix

| Starting condition | Requested route | Expected behavior |
| --- | --- | --- |
| Session check pending | Any | Show the session-check screen until verification resolves |
| No stored token | Any | Show Login without loading protected page data |
| Invalid/expired token | Any | Remove token and stored user, then show Login |
| Login succeeds | Any | Store token/user and navigate to `/scenes` |
| Authenticated, no work scene | `/scenes` or `/choose-scene` | Allow route |
| Authenticated, no work scene | Any simulation/result route | Replace with `/scenes` and show a scene-required notice |
| Work scene selected | `/network` | Allow route and use selected scene context |
| Work scene selected | Browser Back/Forward | Normalize `window.location.pathname` on `popstate` |
| Work scene selected | Unknown route | Show `/scenes` |
| Change scene cancelled | Current route | Keep scene, route, and drafts |
| Change scene confirmed | Any protected route | Clear all current-scene simulation drafts, clear work-scene state, and navigate to `/scenes` |
| Scene activated/created | `/scenes` or `/choose-scene` | Cache fixed antennas, set work scene, and navigate to `/network` |

## Navigation Visibility

- Login and session-check screens do not render the application navbar.
- With no work scene, planning/result route buttons are not shown.
- With a work scene, `/scenes` is omitted from the normal route buttons.
- Queue and History are grouped as result routes.
- Other visible routes are grouped as planning tools.
- Busy state disables navbar navigation.
- Change scene is available through the username menu and requires confirmation.

## Route Side Effects

- Entering `/history` loads History for the selected scene.
- Entering `/queue` loads jobs and polls every five seconds while a queued or
  running job exists.
- Changing the active scene clears displayed Network Coverage result state and
  resets History comparison/selection state.
- Closing a modal or queue submission prompt with Escape retains the current
  route.
- Scene creation checks the imported-scene limit before opening `/choose-scene`.

## Automated Baseline

`test/fixtures/refactor/frontend_contract.json` records the ordered route labels
from `frontend/src/constants/routes.js`, plus internal routes and the fallback.
`test/test_refactor_contracts.py` detects changes to the exported navbar route
list. Browser-level route tests should be added before replacing the manual
router.
