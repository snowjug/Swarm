# The public edition of the page

What the browser does in the **public edition** (`SWARM_EDITION=public`): a landing page with a one-press guest start
("Try it now", no sign-in) and, where the server lists them, an optional sign-in with Google or GitHub, a meter of free
runs, a panel for the person's own Google Gemini key, an account panel that can delete the account (or a guest's data), a
sample that needs no model, and the status, FAQ, legal and administrator pages. The contract it is built to is
[`docs/public/DESIGN.md`](../../../docs/public/DESIGN.md), section 9, and [`shared/public.ts`](../../../shared/public.ts).

Everything is in this folder. A few small, reviewed seams touch the application (below).

## The hard rule: the pilot does not change

The public edition is on **only** when the server puts `<meta name="swarm-edition" content="public">` in `index.html`.

- **Detection is synchronous and reads the page only** (`edition.ts`). No request is made to find it.
- **`main.tsx`** calls `bootEdition()` once. It sets a module switch (`runtime.ts`, `inPublicEdition()`), which is `false`
  by default and is turned on only by the tag.
- **`app/Root.tsx`** draws `<PublicGate><Application /></PublicGate>` only with the tag. The gate is a lazy chunk, so a pilot
  never downloads it (`PublicGate-*.js` in the build). Without the tag the tree is exactly `<Application />`, or the pilot's
  own `SignInProblem` for `?signin=failed|norole`.
- **`api.ts`** is inert without the switch. `checkedFetch` is exported (it was private); in public mode only it adds the
  key headers, maps the public error codes to calm words, and sends a 401 to the landing page. With the switch off its
  behaviour, headers, messages and the `/auth/login` redirect are the ones it had.
- **`app/TopBar.tsx`** and **`app/SettingsMenu.tsx`** read a React context (`slots.ts`) that has no provider in the pilot,
  so the bar and the menu are what they were.
- **`lib/signIn.ts`** and **`panels/SignInProblem.tsx`** are untouched. The public reasons are read by a separate parser
  (`problems.ts`, `publicSignInProblem`).

Proved by tests: `pilot.test.ts` (Node, no page at all: nothing of the page or of the tab's storage is read to make a
request, the headers are the pilot's with a key sitting in the tab, a 401 still goes to `/auth/login`, public codes keep the
server's message), `gate.interaction.test.tsx` ("a page without the tag": no request, no public screen at any address,
the pilot's sign-in problem unchanged), and the existing frontend suites, which pass unchanged.

`GET /api/config` answers `capabilities.authentication = 'public-session'`, so the shell's own `signedIn` stays false:
there is no People, no Who has access and no Share anywhere. The public menu replaces the pilot's account block, and
the "Who has access" item is also hidden whenever the public slots are present, whatever the flag says.

## How the page decides

1. **Edition** (above). No tag: stop.
2. **Gate** (`PublicGate.tsx`, `useGateSession.ts`). One plain `fetch` of `GET /api/public/session` (not the request helper,
   so a 401 is an answer and never a redirect). Then:

   | Answer                                           | The page shows                                                             |
   | ------------------------------------------------ | -------------------------------------------------------------------------- |
   | not read yet                                     | a loader (`gate-loading`)                                                  |
   | HTTP 503                                         | the maintenance screen (`maintenance`)                                     |
   | no answer, other error, or not the session shape | "We can't reach the service right now." (`unreachable`) with Try again     |
   | `signedIn: false`, and `/?signin=<reason>`       | the explanation of that reason (`signin-problem`, `data-problem=<reason>`) |
   | `signedIn: false`, `guestMode: true`             | the landing page with "Try it now" (`try-it-now`) and `guest-note`         |
   | `signedIn: false`                                | the landing page (`landing`)                                               |
   | `signedIn: true`                                 | the existing `<Application />` inside `PublicChrome`                       |
   | `signedIn: true`, `user.guest`                   | the same, with "Guest" for the address, no Sign out, "Delete my data"      |

   A field the server leaves out takes the value that hides nothing (`signupsOpen`, `byokEnabled`: true; `guestMode`,
   `user.guest`: false; `guestRetentionHours`: 24). With `guestMode` the landing offers "Try it now" first, the providers
   the server lists as one quiet line ("Or sign in with Google", `signin-secondary`) and, if it lists none, nothing of
   signing in at all.

3. **Paths** (`pages.ts`). The server already falls back to `index.html` for any HTML `GET` outside `/api` and `/auth/`.
   `/status`, `/faq`, `/legal/terms`, `/legal/privacy` need no session and are shown whatever the session answer is.
   `/admin` waits for the session and is shown only if `session.user.isAdmin`. Any other path is the application. In-app
   moves between these pages use `history.pushState` (`PageLink`); from inside the application the links open in a new tab,
   so that unsaved work is never left.
4. **Signed in** (`PublicChrome.tsx`) adds around the unchanged application: the usage meter in the top bar, the public
   part of the settings menu, the BYOK and account panels, the limit card, and the sample for an empty account.
5. **A 401 `SIGN_IN_REQUIRED`** on any request: the key is forgotten, the gate returns to the landing page with the line
   "Your session ended. Sign in again to continue." (`landing-note`, `data-kind=expired`; with `guestMode`, "Your session
   ended. Press Try it now to start again."). `ACCOUNT_DISABLED` does the same with `data-kind=disabled`. The request that
   found out never settles, as in the pilot.

## The key

Held in `byokStore.ts` only: memory and `sessionStorage` (`swarm.byok.key`, `swarm.byok.model` from `BYOK_STORAGE_KEYS`, and
`swarm.byok.models`, a list of model names for the picker). Never `localStorage`, never an address, never a log line, a
thrown message or a toast. Only its last four characters are shown (`…1234`), computed in the page.

- **Sent** as `x-swarm-provider: gemini`, `x-swarm-provider-key`, and `x-swarm-provider-model` (only once a model is
  chosen) on every `POST`, `PUT`, `PATCH` and `DELETE`, and on the two reads that say what the person's funding is,
  `GET /api/usage` and `GET /api/provider/status` (the model chip). On no other read, on no other origin, and on
  `POST /api/byok/connect` only the key that is in the field.
- **Cleared** by Forget key (which also asks the server to drop its in-memory copy, `DELETE /api/byok`, after the key has
  left the tab so that the request does not carry it), by sign-out (before the request is sent), by account deletion (after
  it succeeds; for a guest that is "Delete my data", the same code path, and the server drops its copy as it deletes), and
  by any 401 or `ACCOUNT_DISABLED`.
- Kept only if the key is valid. A key is checked for shape (visible characters, 8 to 512) before anything is sent.

## Errors and limits

The page decides from the **code**, never the server's message (`problems.ts`). Every code of `PUBLIC_ERROR_CODES` has one calm
sentence and one next step. The request that failed throws an `ApiError` with that sentence, so every place in the
application that shows a request error shows it too. Codes that the person can act on also raise the **limit card**
(`limit-reached`), once, until it is dealt with.

| Code                                                                 | `data-reason`                                                       | Step                          |
| -------------------------------------------------------------------- | ------------------------------------------------------------------- | ----------------------------- |
| `FREE_TIER_USER_CAP` / `_GLOBAL_CAP` / `_LIFETIME_CAP` / `_DISABLED` | `user-cap` / `global-cap` / `lifetime-cap` / `disabled`             | Use your own key (BYOK panel) |
| `FREE_TIER_CONCURRENT`                                               | `concurrent`                                                        | Check again (reads the meter) |
| `BYOK_KEY_NEEDED`                                                    | `byok-key-needed`                                                   | Add your key (BYOK panel)     |
| `BYOK_KEY_REJECTED`, `BYOK_REGION`                                   | `byok-key-rejected`, `byok-region`                                  | Change key (BYOK panel)       |
| `BYOK_RATE_LIMITED`, `BYOK_MODEL_NOT_FOUND`                          | `byok-rate-limited`, `byok-model-not-found`                         | Choose a model (BYOK panel)   |
| `BYOK_QUOTA`                                                         | `byok-quota`                                                        | Check my key (BYOK panel)     |
| `BYOK_BLOCKED`, `PROJECT_LIMIT`, `STORAGE_LIMIT`, `RUN_IN_PROGRESS`  | `byok-blocked`, `project-limit`, `storage-limit`, `run-in-progress` | Okay                          |
| `ACCOUNT_DISABLED`                                                   | none: back to the landing page                                      |                               |
| `BOT_CHECK_FAILED` (sign-in or guest), `NOT_AVAILABLE`               | none: told in place, no card                                        |                               |

The card also has `data-code` (the code as sent) and its button is `limit-action`.

Starting as a guest (`guestFailure`) is told in place, in `guest-error` (`role="alert"`), from the code and never the
server's message: `NOT_AVAILABLE` ("Guest access is not available right now"), `429` or `RATE_LIMITED` ("Wait a few
minutes"), `BOT_CHECK_FAILED`, a network failure, and one calm sentence for anything else.

The meter says the same for a free tier that cannot be used (`usage-meter`, `data-usage="limit"`, `data-reason`): its
popover holds the sentence and the one step. Only **one** element with `data-testid="limit-reached"` exists at a time: the
card, or, when no card is up, the block in the meter's popover.

## Every request the page makes

All changes carry `X-Swarm-CSRF: 1`. `Accept: application/json` on every request. "+ key" means the three key headers above,
only while a key is held.

| When                                                                                                                                                                                        | Method and path                                             | Headers                                                                                           | Body                                                                                                                                                                                                                                                           |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Page load, public edition only (plain `fetch`)                                                                                                                                              | `GET /api/public/session`                                   | `Accept`                                                                                          |                                                                                                                                                                                                                                                                |
| `/status`                                                                                                                                                                                   | `GET /api/public/status`                                    | `Accept`                                                                                          |                                                                                                                                                                                                                                                                |
| `/legal/terms`, `/legal/privacy`                                                                                                                                                            | `GET /api/public/legal/terms` or `privacy`                  | `Accept`                                                                                          |                                                                                                                                                                                                                                                                |
| A provider button (plain `fetch`)                                                                                                                                                           | `POST /auth/start/:provider`                                | `Content-Type: application/json`, CSRF                                                            | `{ returnTo?, turnstileToken? }` (`{}` when neither)                                                                                                                                                                                                           |
| Then                                                                                                                                                                                        | `window.location.assign(response.url)`                      |                                                                                                   | only a `http:` or `https:` address is followed                                                                                                                                                                                                                 |
| "Try it now" (plain `fetch`), only with `session.guestMode`                                                                                                                                 | `POST /auth/guest`                                          | `Content-Type: application/json`, CSRF                                                            | `{}` (`{ turnstileToken }` when `session.bot` is set). The session cookie is in the answer's headers: the page never sees it                                                                                                                                   |
| Then                                                                                                                                                                                        | `GET /api/public/session`                                   | `Accept`                                                                                          | read again so that the gate shows the application; the address's query (`?project=...`) is dropped first                                                                                                                                                       |
| Only when `session.bot` is set, in the sign-in card                                                                                                                                         | `GET https://challenges.cloudflare.com/turnstile/v0/api.js` | (a script tag)                                                                                    | never loaded otherwise                                                                                                                                                                                                                                         |
| Signed in: on load, 0.5 s and 8 s after each accepted change, after a refusal (once per code every 10 s), when the key is added or forgotten, when the tab is shown, every 30 s while it is | `GET /api/usage`                                            | + key                                                                                             |                                                                                                                                                                                                                                                                |
| Signed in, first screen without `?project=`, not put away                                                                                                                                   | `GET /api/account`                                          |                                                                                                   | (shows the sample when `projects.count` is 0)                                                                                                                                                                                                                  |
| Account panel opened                                                                                                                                                                        | `GET /api/account`                                          |                                                                                                   |                                                                                                                                                                                                                                                                |
| Connect, or Check key again                                                                                                                                                                 | `POST /api/byok/connect`                                    | CSRF, `x-swarm-provider: gemini`, `x-swarm-provider-key: <the key in the field, or the held one>` | none                                                                                                                                                                                                                                                           |
| Forget key                                                                                                                                                                                  | `DELETE /api/byok`                                          | CSRF (the key has already gone from the tab)                                                      |
| Sign out                                                                                                                                                                                    | `POST /auth/logout`                                         | CSRF (the key is already gone)                                                                    |                                                                                                                                                                                                                                                                |
| Delete my account and all my data                                                                                                                                                           | `DELETE /api/account`                                       | `Content-Type`, CSRF, + key                                                                       | `{ "confirm": "delete my account" }`                                                                                                                                                                                                                           |
| Delete my data (a guest)                                                                                                                                                                    | `DELETE /api/account`                                       | `Content-Type`, CSRF, + key                                                                       | the same body, sent by the page: nothing is typed                                                                                                                                                                                                              |
| Try a sample                                                                                                                                                                                | `POST /api/projects`                                        | `Content-Type`, CSRF, + key                                                                       | a new exploration: `name` "Sample: Launch pricing", the example's `question` and `documents`, `workflow: "guided"`, `settings: { mode: "local", agentCount: 12, rounds: 8, seed: 42, network: "community", intervention: null }`; no `scenario`, no `research` |
| Then                                                                                                                                                                                        | `POST /api/projects/:id/steps/knowledge`                    | CSRF, + key                                                                                       | none. A failure here is ignored: Ground offers to read the evidence again                                                                                                                                                                                      |
| Then                                                                                                                                                                                        | `window.location.assign("/?project=:id")`                   |                                                                                                   |                                                                                                                                                                                                                                                                |
| `/admin`                                                                                                                                                                                    | `GET /api/admin/usage?days=14`                              |                                                                                                   |                                                                                                                                                                                                                                                                |
| Admin buttons                                                                                                                                                                               | `POST /api/admin/free-tier`                                 | `Content-Type`, CSRF                                                                              | `{ "enabled": boolean }`                                                                                                                                                                                                                                       |
|                                                                                                                                                                                             | `POST /api/admin/signups`                                   | `Content-Type`, CSRF                                                                              | `{ "enabled": boolean }`                                                                                                                                                                                                                                       |
|                                                                                                                                                                                             | `POST /api/admin/users/:id/disable`                         | `Content-Type`, CSRF                                                                              | `{ "disabled": boolean }`                                                                                                                                                                                                                                      |
| Everything else                                                                                                                                                                             | the unchanged application's requests                        | changes carry + key                                                                               |                                                                                                                                                                                                                                                                |

The sample uses the rules engine (`settings.mode: "local"`) and nothing that can use a model, so it works with no free
tokens and no key. The page never sends a token limit, a deployment or a model other than the one the person picked.

## Test ids

For the end-to-end tests. They are stable: change one only together with its test.

| Where                   | `data-testid`                                                                                                                                                                                                                                                                                                       |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Landing                 | `landing`, `try-it-free` (the "Try it free" button), `landing-note` (`data-kind`: `expired`, `disabled`, `deleted`, `signed-out`), `faq` (the same section on the landing page and on `/faq`)                                                                                                                       |
| Landing, guest mode     | `try-it-now` (the one primary button; `try-it-free` is not there), `guest-note`, `guest-error` (a refusal, `role="alert"`), `signin-secondary` (the quiet "Or sign in with Google" line: only for providers the server lists, and none when it lists none)                                                          |
| Sign-in card (a dialog) | `signin-card`, `signin-google`, `signin-github` (`signin-<id>` for any provider the server lists)                                                                                                                                                                                                                   |
| Sign-in problem         | `signin-problem` (`data-problem`: `failed`, `closed`, `unverified`, `disabled`, `blocked`)                                                                                                                                                                                                                          |
| Gate screens            | `gate-loading`, `maintenance`, `unreachable`                                                                                                                                                                                                                                                                        |
| Usage meter (top bar)   | `usage-meter` (the chip: its text is the whole line; `data-usage` = `free`, `byok`, `limit`, `unknown`; `data-reason` for `limit`; `data-tone`), `usage-upgrade` (the quiet link in its popover)                                                                                                                    |
| Limit state             | `limit-reached` (`data-reason`, `data-code`), `limit-action` (its button)                                                                                                                                                                                                                                           |
| BYOK panel              | `byok-panel`, `byok-key` (password field), `byok-connect`, `byok-status` (`data-status`: `idle`, `connected`, `valid`, `invalid`, `rate-limited`, `quota`, `region`, `unreachable`, `disabled`, `local`, `forgotten`), `byok-held`, `byok-hint` (only `…1234`), `byok-model` (select), `byok-forget`, `byok-notice` |
| Account panel           | `account-panel`, `account-email`, `account-provider`, `account-projects`, `account-storage`, `account-signout`, `account-delete`, `account-delete-confirm-input`, `account-delete-confirm`, `guest-reminder` (a guest only)                                                                                         |
| Settings menu           | `menu-account`, `menu-byok`, `try-sample-menu`, `menu-signout`, `menu-email`, `menu-guest-reminder` (a guest only)                                                                                                                                                                                                  |
| Sample                  | `welcome` (the card for an empty account), `try-sample` (its button), `try-sample-menu` (the menu item)                                                                                                                                                                                                             |
| Status                  | `status-page` (`data-status`: `loading`, `ok`, `degraded`, `maintenance`, `unreachable`), `status-free-tier`, `status-resets`, `status-byok`, `status-signups`                                                                                                                                                      |
| Legal                   | `legal-page` (`data-doc`), `legal-unreviewed` (the banner, only when `reviewed` is false)                                                                                                                                                                                                                           |
| Administrator           | `admin-page`, `admin-loading`, `admin-denied`, `admin-today`, `admin-days`, `admin-users`, `admin-blocked`, `admin-free-tier`, `admin-signups`, `admin-free-tier-row`, `admin-signups-row`, `admin-disable-<id>`, `admin-disable-confirm-<id>`, `admin-enable-<id>`                                                 |

## Things an end-to-end test will meet

- **Sign-in navigates the page** with `window.location.assign(url)`. A fake identity provider's `url` may be `http://`.
- **"Try it now" does not navigate**: `POST /auth/guest` sets the session cookie, the page reads `GET /api/public/session` again,
  and the gate swaps the landing page for the application with no reload (the address's query is dropped first). With
  `session.bot` the button, like the sign-in buttons, waits for the Turnstile token.
- **A guest** has `menu-email` and `account-email` saying "Guest" (and the reminder that the data is temporary in
  `menu-guest-reminder` and `guest-reminder`); no `menu-signout`, no `account-signout` and no `account-provider`;
  `account-delete` and `account-delete-confirm` read "Delete my data", and the confirm step has no
  `account-delete-confirm-input`: the page sends the phrase itself. The dialog is still named "Your account".
- **Dialogs** (sign-in, BYOK, account) are Radix dialogs; they animate for about 0.3 s unless the browser asks for reduced motion.
- **The meter** is read 0.5 s after an accepted change and again 8 s later, so a run that finishes shows its use without a reload.
- **The sample reloads the page** at `/?project=<id>` once the project exists.
- **The welcome card** shows only on the first screen (no `?project=`), only for an account with 0 projects, and not after it was put
  away in that tab. The menu's "Try a sample" is always there.
- **Turnstile**: the sign-in buttons stay disabled until the check gives a token. Tests replace the loader with
  `setTurnstileLoader` (`turnstile.ts`); the script is never fetched in a test.
- **After a reload the picker** shows the models the last check found (kept in the tab). The key is checked again with the
  button, which then reads "Check key again".
- **The usage meter's words** are in the DOM at every width; below 40 rem (and at any width once a project is open) the bar
  shows an icon and the number, and the whole line is in the tooltip and the accessible name.

## Files

| File                                                                                                                                                    | What it is                                                                                      |
| ------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `runtime.ts`, `edition.ts`                                                                                                                              | the switch, the signals from the API client, and the tag                                        |
| `byokStore.ts`, `useByok.ts`                                                                                                                            | the key: where it lives, the headers, its shape check                                           |
| `problems.ts`                                                                                                                                           | every word about a limit, a refusal or a sign-in that did not work                              |
| `publicApi.ts`, `useGateSession.ts`, `pages.ts`, `PageLink.tsx`                                                                                         | the requests, the session and its shape, the paths                                              |
| `PublicGate.tsx`, `GateScreens.tsx`, `StandaloneCard.tsx`, `PublicFrame.tsx`                                                                            | the gate and the pages around it                                                                |
| `Landing.tsx`, `GuestStart.tsx`, `SignInCard.tsx`, `BotCheck.tsx`, `turnstile.ts`, `useTurnstile.ts`, `guest.ts`                                        | the landing page, the ways in (guest, sign-in), the bot check, the guest words                  |
| `Faq.tsx`, `StatusPage.tsx`, `LegalPage.tsx`, `legalText.ts`, `AdminPage.tsx`, `format.ts`                                                              | the other pages                                                                                 |
| `PublicChrome.tsx`, `slots.ts`, `UsageMeter.tsx`, `usageView.ts`, `useUsage.ts`                                                                         | what a signed-in person gets around the application                                             |
| `ByokPanel.tsx`, `AccountPanel.tsx`, `accountActions.ts`, `LimitReached.tsx`, `Welcome.tsx`, `PublicMenu.tsx`, `sample.ts`, `tabState.ts`, `browser.ts` | the panels, the cards, the sample, the tab's state, and the browser calls that a test can watch |
| `public.css`                                                                                                                                            | the styles, in the design system's `scenes` layer                                               |
| `test/`                                                                                                                                                 | `fakeServer` (a table of `"METHOD /path"` answers in place of `fetch`) and the fixtures         |

Tests: `npx vitest run frontend/src/public`. None of them touches the network: the server, the bot check and the browser's
address are fakes.
