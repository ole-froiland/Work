# Reparerbare tilkoblinger i panelet

Dato: 2026-08-22
Prosjekt: `ipad-control-center`

## Problemet

Statusstripa nederst til høyre i panelet sier hvor mange tilkoblinger som er nede,
og modalen bak den lister opp alle fem: Apple Kalender, Sync-notater,
iPhone-verdier, Codex-bruk og Claude-bruk. Lista er ren lesning. Når noe er rødt
— akkurat nå «Claude-pålogging kunne ikke fornyes (400)» — må Ole reise seg,
finne Mac-en og gjette seg fram til hva som skal gjøres. Panelet vet hva som er
galt og gjør ingenting med det.

Målet: ett trykk på raden, og panelet gjør alt det faktisk kan gjøre selv.

## Mål

- Hver rad i Tilkobling-modalen er en knapp som starter en reparasjon.
- Reparasjonen kjører hele veien på ett trykk, uten mellomsteg som må bekreftes.
- Når et menneskelig steg gjenstår, sier raden nøyaktig hvilket — og tilbyr en
  knapp der en knapp kan gjøre nytte.
- Raden oppdaterer seg med det virkelige resultatet, ikke med et løfte.

## Ikke mål

- Ingen ny statusstripe, nytt kort eller ny plassering. Modalen er den samme,
  radene får oppførsel.
- Ingen automatisk reparasjon i bakgrunnen. Panelet reparerer når Ole ber om det.
- Ingen endring i hva sjekkene måler. `buildStatusChecks` beholder sin logikk.

## To diagnosehull som må tettes først

En knapp som ikke vet hva som er galt, kan bare gjette. To steder i dagens kode
kastes årsaken bort, og begge må rettes før sekvensene under gir mening:

1. `server/sync-calendar-service.mjs` — `refreshMacAppleCalendar()` avslutter med
   `.catch(() => {})`. Om Apple-lesingen feiler fordi Kalender mangler
   tilgangstillatelse, fordi osascript-skriptet brekker, eller fordi Kalender ikke
   kjører, er utad umulig å se: `connected` blir bare `false`. Feilen må lagres på
   `appleCache` (tidspunkt + melding) og eksponeres gjennom `getSyncCalendar()`.
2. `server/usage-service.mjs` — `refreshClaudeCredentials()` kaster
   `Claude-pålogging kunne ikke fornyes (${response.status})` og forkaster
   svarkroppen. Token-endepunktet svarer med `error` og `error_description`.
   Begge feltene må leses og følge med feilen videre, slik at panelet kan skille
   `invalid_grant` (Ole må logge inn igjen) fra alt annet (feil i panelets egen
   forespørsel — vår bug, ikke hans).

Verdiene i Nøkkelringen er sjekket: refresh-tokenet er ikke utløpt, det er gyldig
til 2026-08-23. 400-en har altså en annen årsak enn utløp, og vi vet ikke hvilken
før feilteksten kommer fram. Sekvensen for Claude under håndterer begge greinene.

## Reparasjonssekvenser

Én sekvens per sjekk-id. Alle kjører på Mac-en, tar `exec` og `fetch` som
argumenter, og returnerer en liste over steg som ble forsøkt.

### `calendar` — Apple Kalender

1. Tving en ny Apple-lesing forbi `APPLE_CACHE_MS`-cachen på to minutter, og la
   feilen boble opp denne gangen.
2. Sier feilen at Kalender ikke kjører: start den i bakgrunnen med
   `open -g -a Kalender`, vent inntil tre sekunder på at den svarer, les én gang
   til.
3. Sier feilen at tilgang mangler: gjenstående steg er «Gi Panel tilgang til
   Kalender», med knapp som åpner Personvern-ruta i Systeminnstillinger.

### `notes` — Sync-notater

1. Hent `/api/sync-notes` på nytt.
2. Fortsatt tomt: åpne Sync i Chrome på Mac-en (samme Apple-hendelse som
   `sync-projects`-handlingen bruker i dag), og poll i inntil ti sekunder på at
   nettsida poster notatene sine.
3. Kom det ingenting: raden sier at Sync-fanen må stå åpen på Mac-en.

### `mobile` — iPhone-verdier

1. Hent `/api/device-metrics` på nytt.
2. Skill mellom de tre tilstandene som betyr helt forskjellige ting:
   har aldri sendt, har sendt for lenge siden, eller kjører en companion-versjon
   uten sosial tid (`needsCompanionUpdate`).
3. Ingen knapp. Companion-appen pusher via `BGTaskScheduler` og har ingen kanal
   andre veien — Mac-en kan ikke be telefonen om noe. Raden sier hva Ole må gjøre
   på telefonen, og lyver ikke med en knapp som ikke virker.

### `codex` — Codex-bruk

1. `getUsageSnapshot({ force: true })`.
2. Henger eller svarer ikke RPC-en: drep `CodexRpcClient`-prosessen, la
   `ensureStarted()` spawne `codex app-server` på nytt, og hent én gang til.
3. Er Codex ikke logget inn: gjenstående steg åpner Terminal med `codex login`.

### `claude` — Claude-bruk

1. Les Nøkkelringen på nytt og tving fornyelse — Claude Code roterer tokenet sitt
   selv, så en ny lesing er ofte hele fiksen.
2. `invalid_grant`: gjenstående steg åpner Terminal med `claude`, og raden sier at
   `/login` må skrives i vinduet som dukker opp. Siste godkjenning skjer i
   nettleseren på Mac-en og kan ikke gjøres fra iPaden.
3. Annen feilkode: raden viser leverandørens egen feiltekst ordrett. Da er det
   panelets forespørsel som er gal, og det er en bug vi retter — ikke noe Ole
   skal fikse.

## Server

Ny modul `server/connection-repair-service.mjs` med sekvensene over, én
eksportert `repairConnection(id, { exec, fetch })`. Ingen av dem importerer noe
fra `src/`.

Nytt endepunkt i `vite.config.mjs`:

```
POST /api/connections/repair   { "id": "claude" }
```

Svar:

```json
{
  "id": "claude",
  "ok": false,
  "detail": "Claude avviste fornyelsen",
  "steps": [
    { "label": "Leste Nøkkelringen på nytt", "ok": true },
    { "label": "Fornyet pålogging", "ok": false, "detail": "invalid_grant" }
  ],
  "next": { "action": "claude-login", "label": "Åpne Terminal med claude" }
}
```

- Annen metode enn POST gir 405, ukjent id gir 400.
- Én reparasjon i flyt per id om gangen; nye trykk på samme rad mens den jobber
  returnerer den pågående sekvensen i stedet for å starte en til.
- Hele sekvensen har et tak på 20 sekunder. Går den over, svarer endepunktet med
  `ok: false` og «Tok for lang tid».
- Svaret inneholder aldri tokener, nøkler eller innhold fra Nøkkelringen. Fra
  token-endepunktet slippes bare `error` og `error_description` gjennom.

Tre nye Mac-handlinger i `mac-action-service.mjs`, for `next`-knappene:
`calendar-privacy`, `claude-login`, `codex-login`. De interne stegene i
sekvensene (starte Kalender, åpne Sync, restarte Codex) kjører direkte i
reparasjonsmodulen og trenger ikke ligge i handlingsregisteret.

## Klient

### Radenes tilstander

| Tilstand | Utseende |
|---|---|
| `idle` | Som i dag, men hele raden er en knapp |
| `working` | «Prøver …» med spinner, raden er deaktivert |
| `fixed` | Grønn, med hva som faktisk ble gjort |
| `stuck` | Fortsatt rød, med det ene steget som gjenstår og evt. knapp |

Grønne rader er også trykkbare og betyr «sjekk på nytt». `fixed` og `stuck`
faller tilbake til `idle` når modalen lukkes, slik at neste åpning viser den
ekte statusen fra `buildStatusChecks` og ikke et gammelt resultat.

Tapp-målene holder iPad-avstand: radene beholder høyden de har, og teksten går
ikke under 13 px, i tråd med `AGENTS.md`.

### Oppfrisking etter reparasjon

Dataloaderne i `App.jsx` ligger i dag låst inne i hver sin `useEffect`-lukking og
kan ikke kalles utenfra. iPhone-verdier hentes hvert 60. sekund, så en rad ville
stått rød i opptil et minutt etter at den faktisk var i orden.

Loaderne for de fire kildene statussjekkene bygger på — sync-calendar,
sync-notes, device-metrics og usage — trekkes ut i én liten
`usePolledResource(url, { interval, parse, onError })` som returnerer verdien og
en `refresh`-funksjon. Reparasjonsflyten kaller `refresh` for sin kilde med én
gang sekvensen er ferdig. Loaderne for agent-sessions og Spotify står urørt; de
inngår ikke i statussjekkene, og å konvertere dem hører ikke til denne jobben.

### Tekst

Setningene radene viser bygges av rene funksjoner ved siden av
`buildStatusChecks` i `src/dashboard.js`, slik at de kan testes uten React og
uten Mac. All tekst på norsk, i samme knappe tone som resten av panelet.

## Testing

- `tests/connection-repair.test.mjs` (ny): hver sekvens med injisert `exec` og
  `fetch` — vellykket fiks, fiks som krever steg to, og feil som ikke kan
  repareres. Verifiserer også at tokener aldri havner i svaret.
- `tests/dashboard.test.mjs`: de nye tekstfunksjonene, inkludert de tre
  iPhone-tilstandene.
- `tests/vite-config.test.mjs`: at `/api/connections/repair` er registrert, og at
  405 og 400 svarer som beskrevet.
- `tests/usage-service.test.mjs`: at `error_description` fra token-endepunktet
  følger med feilen, og at tokenverdier ikke gjør det.
- `tests/sync-calendar.test.mjs`: at en feilet Apple-lesing nå etterlater en
  lesbar årsak i stedet for stillhet.
- `npm test` og `npm run test:sites` skal være grønne. Endelig verifikasjon skjer
  i panelet i nettleseren, ikke bare i testene.

## Det som fortsatt ikke kan fikses med ett trykk

To ting, og de sies rett ut i grensesnittet framfor å pakkes inn:

- **iPhone-verdier.** Telefonen bestemmer selv når den sender. Ingen knapp på
  Mac-en endrer det.
- **Claude-innlogging ved `invalid_grant`.** OAuth-runden må godkjennes i en
  nettleser på Mac-en. Panelet kommer så langt som å åpne Terminal med `claude`
  klar; resten er Oles hender.
