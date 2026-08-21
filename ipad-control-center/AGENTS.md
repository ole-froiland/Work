# Prototype Instructions

Run the local server yourself and open the preview in the browser available to this environment. Do not give the user server-start instructions when you can run it.

Before making substantial visual changes, use the Product Design plugin's `get-context` skill when the visual source is unclear or no longer matches the current goal. When the user gives durable prototype-specific design feedback, preferences, or decisions, record them in `AGENTS.md`.

When implementing from a selected generated mock, treat that image as the source of truth for layout, component anatomy, density, spacing, color, typography, visible content, and hierarchy.

Build app UI in `src/`. Keep `.openai/hosting.json`, `worker/index.js`, `scripts/prepare-sites-build.mjs`, and `tests/sites-worker.test.mjs` intact so the same local prototype can be handed to Sites. Before a Sites handoff, run `npm run build` and `npm run test:sites`; the build must leave `dist/client/index.html`, `dist/server/index.js`, and `dist/.openai/hosting.json`.

Usage and quota UI must show provider-reported Codex and Claude values only. Never estimate missing usage. Refresh automatically, offer a manual refresh control, and make provider errors explicit without exposing credentials to the browser.
Show both used and remaining quota plus a precise reset countdown. Vis nedtellingen så lenge leverandøren har oppgitt et nullstillingstidspunkt, også når vinduet er merket inaktivt — Claude sender `is_active: false` for ukesvinduet selv når det har både forbruk og tidspunkt. «Starter ved neste bruk» er bare riktig når tidspunktet mangler helt. Keep account-level and local-only daily usage explicitly labeled; never present local Claude Code token totals as whole-account Claude usage.
In the compact usage card, prioritize large remaining-percent values and reset countdowns. Hide provider provenance, token totals, and auto-refresh timestamps from the normal UI unless the user asks for diagnostics.

Oppgavekortet under AI-bruk viser bare de tre nyeste øktene Claude og Codex selv har skrevet i samtaleloggene sine på Mac-en. Aldri fabrikker agentaktivitet eller demo-agenter: uten logger skal kortet si eksplisitt at ingenting kjører. Hver rad skal alltid vise arbeidsmappen og skille tydelig mellom «Jobber», «Ferdig», «Trenger svar» (sluttmeldingen ber Ole svare) og «Avsluttet» (turen stoppet uten et fullført svar) — det er hele spørsmålet kortet finnes for å svare på. Vis hva økta gjør på norsk, ikke verktøynavnet fra loggen, og send aldri innholdet i samtalene til nettleseren.

Musikkortet under hurtigknappene styrer Spotify Connect, ikke Spotify-appen på Mac-en, slik at det treffer enheten som faktisk spiller. Vis bare spor, enhet og framdrift Spotify selv rapporterer, og si eksplisitt fra ved manglende oppsett, manglende enhet eller Premium-krav. Client ID og tokener lagres bare på Mac-en og sendes aldri til nettleseren.

Keep the dashboard free of a global top bar; date, time, connection, and view controls belong in the calendar toolbar. Quick actions should stay compact while preserving practical iPad tap targets, and the landscape dashboard must fit the viewport without page scrolling.

Never fabricate mobile Screen Time, Health, step, or location data. Show an explicit unsynced state until a permissioned device source has supplied values; weather uses a verified CoreLocation source or the explicit Mosterøy fallback.

Mobile status values must come from the `ios-companion` app with verified DeviceActivity, HealthKit, and CoreLocation source metadata. Do not accept browser geolocation or unverified POST values for these cards.

Skjermtidskortet måler bare sosiale medier, ikke total skjermtid — det er den tiden Ole vil ned på, og alt annet er støy. Filteret ligger i telefonen (`ios-companion/Sources/SocialApps.swift`), slik at bruken av øvrige apper aldri sendes til Mac-en; `src/dashboard.js` har samme liste og filtrerer en gang til mot eldre mellomlagrede data. Endres den ene lista, må den andre endres i samme slengen. Panelteksten skal være lesbar på iPad-avstand: ikke gå under 13 px i statusstripa eller i metrikkbobla.
