# Dagsplan som skyver seg når Ole står opp

Dato: 2026-08-28
Prosjekt: `ipad-control-center`

## Problemet

Panelet viser dagen som den står i Apple Kalender. Det er riktig for avtaler med
andre mennesker, og feil for alt annet Ole har tenkt å gjøre. Rutinen — lese,
trene, spise — er ikke avtaler. Den er en rekkefølge med varigheter som skal
starte når dagen faktisk starter.

Forsøket på å legge rutinen inn som ekte kalenderavtaler ligger igjen i koden:
`HIDDEN_APPLE_CALENDARS` i `server/sync-calendar-service.mjs` skrur av både
`Rutine H26` og `NHH H26`, fordi den gamle planen la seg oppå den nye. En rutine
tåler ikke å bo i samme system som avtaler, nettopp fordi den skal flytte seg og
avtalene ikke skal.

Og den flytter seg ikke. Sover Ole til 09:40 når planen var skrevet fra 07:00,
står hele dagen igjen på veggen med tidspunkter som ikke gjelder lenger. Ingenting
sier hva som nå skjer når, og ingenting sier hva som ikke lenger får plass.

Målet: bolkene legger seg ut fra det klokkeslettet Ole faktisk sto opp, og panelet
finner ut av det klokkeslettet selv.

## Mål

- Panelet eier en dagsmal — bolker med navn og varighet i rekkefølge — atskilt fra
  Apple Kalender.
- Apple-avtalene er ankre. De flytter seg ikke, og bolkene legger seg rundt dem.
- Panelet oppdager selv når Ole står opp, uten at han gjør noe.
- Et oppdaget oppvåkningstidspunkt kan alltid overstyres med ett trykk.
- Bolker som ikke får plass før dagen er over vises som nettopp det, ikke slettes.

## Ikke mål

- Ingen skriving av rutinen til Apple Kalender. Se «Hvorfor ikke Apple Kalender».
- Ingen komprimering av dagen. Bolkene skyves like langt; de krympes ikke for å
  lande på samme sluttid. Dette var et eksplisitt valg fra Ole.
- Ingen ny plan-flate utenfor Mac-en. Se «Kjent begrensning».
- Ingen redigering av malen i panelet. `day-plan.json` skrives for hånd i denne
  omgangen. En bolkeeditor på en iPad-flate er et større stykke arbeid enn selve
  skyvingen, og skyvingen er det Ole faktisk ba om. Editoren kan komme etterpå,
  når malen har stått en stund og formen på den har satt seg.
- Ingen endring i hvordan avtaler leses, tones eller legges ut. `layoutDayEvents`
  og `describeCalendarActivity` beholder sin logikk.

## Hvorfor ikke Apple Kalender

Panelet er ikke rent lesende — `mutateMacAppleCalendar()` kan opprette avtaler.
Men den kan bare det: `operation` godtar utelukkende `"create"`, og det finnes
ingen vei til å endre eller slette en avtale som allerede ligger der.

Å skyve dagen gjennom Apple Kalender ville altså kreve en helt ny evne til å
skrive om eksisterende avtaler. Det er verdt å unngå av seg selv: gjentakende
serier ryker fort når enkeltforekomster flyttes programmatisk, og en rutine som
skrives permanent inn i kalenderen etterlater seg et spor av flyttede avtaler
hver eneste dag Ole sover lenge. Malen bor derfor i panelet, og Apple Kalender
leses som før.

## Datamodell

To filer, med et bevisst skille i hvor de bor.

**Malen** er skrevet av Ole og kan ikke utledes på nytt hvis den forsvinner. Den
hører derfor ikke hjemme i `Caches/`, der `sync-calendar.json` ligger, men i
`~/Library/Application Support/ipad-control-center/day-plan.json`:

    {
      "version": 1,
      "wakeAnchor": "07:00",
      "dayEnd": "23:00",
      "blocks": [
        { "id": "morgen", "title": "Morgenrutine", "minutes": 30, "tone": "sky" },
        { "id": "bus400n", "title": "Lese BUS400N", "minutes": 90, "tone": "violet" }
      ]
    }

`wakeAnchor` er klokkeslettet malen er skrevet for. Det er dette skyvingen måles
mot, og det er grunnen til at malen ikke trenger absolutte tidspunkter per bolk.

**Oppvåkningen** gjelder én dag og kan utledes på nytt i morgen. Den hører hjemme
i `Caches/`, ved siden av kalendercachen:

    { "date": "2026-08-28", "wokeAt": "...T09:40:00+02:00",
      "source": "shortcut" | "usage" | "manual", "confirmed": false,
      "done": [ { "id": "morgen", "at": "...T10:05:00+02:00" } ] }

Én oppføring per dato. `manual` skrives når Ole retter tidspunktet, og en `manual`
overskrives aldri av et senere oppdaget signal.

`done` er bolkene som er huket av, med tidspunktet de faktisk ble gjort på. Det
hører hjemme her og ikke i malen: malen gjelder alle dager, avhukingen gjelder
denne ene. At begge deler faller bort ved midnatt er riktig — en ny dag starter
med hele malen igjen.

## Utleggingen

En ren funksjon i `src/dashboard.js`, ved siden av `layoutDayEvents`, slik at den
kan testes uten server og uten nettleser:

    planDay({ template, wokeAt, anchors, dayEnd }) -> { placed, dropped }

Reglene:

1. `shift = max(0, wokeAt - wakeAnchor)`. Står Ole opp *tidligere* enn malen,
   skjer ingenting. Å dra dagen bakover ville lagt lesingen til 05:30 fordi han
   våknet tidlig én gang, og det er ikke problemet som skal løses. Asymmetrien er
   et valg, ikke en forglemmelse.
2. Markøren starter på `wakeAnchor + shift`. Hver bolk legges ut i rekkefølge fra
   markøren.
3. Treffer en bolk et anker, flyttes markøren til ankerets slutt og bolken legges
   ut på nytt derfra. Bolker deles aldri i to.
4. Slutter en bolk etter `dayEnd`, havner den i `dropped` og markøren står stille.
   Resten av bolkene prøves fortsatt — en kort bolk kan få plass der en lang ikke
   fikk det.
5. Ankre er Apple-avtaler på dagen som *ikke* er heldagsavtaler. En heldagsavtale
   er ingen tidsbegrensning, og ville ellers spist hele dagen.

Bolker Ole har huket av som gjort beholder tidspunktet de faktisk ble gjort på.
Bare det som gjenstår legges ut på nytt. Det gjør at en rettelse midt på dagen
ikke skriver om formiddagen som allerede har vært.

## Oppdagelsen

To signaler inn til det samme nye endepunktet, `POST /api/wake`, montert som de
øvrige i `vite.config.mjs`. Kroppen er `{ wokeAt, source }`.

**Presist — iOS-snarvei.** En personlig automasjon på «Wake Up» eller «alarm
stoppet» sender tidspunktet i det sekundet Ole slår av alarmen. Dette er det
eneste signalet som treffer riktig minutt, og det er derfor primærkilden. Det
krever et engangsoppsett på telefonen som Ole må gjøre selv; snarveien skal kjøre
uten bekreftelse, ellers er den verdiløs på en morgen.

**Uten oppsett — companion.** `ios-companion` har allerede HealthKit,
skjermtidsdata og `UIBackgroundModes: fetch`. En ny `WakeDetector` noterer når
appen blir aktiv, og melder fra ved første aktivitet etter et opphold på mer enn
fire timer, i vinduet 04:00–13:00, når det ikke allerede finnes en oppføring for
dagen. Dette er et heuristisk signal og skal merkes som det.

Companion sender ikke oppvåkningen som en del av `MetricsPayload`. Den lastes opp
når Mac-en er nåbar, og Mac-en sover om morgenen — signalet må derfor kunne
overleve et mislykket forsøk. `WakeDetector` skriver tidspunktet til disk med én
gang og prøver på nytt ved hver senere synkronisering, til Mac-en tar imot det.
Planen er en ren funksjon av `wokeAt`, så et signal som ankommer tre timer for
sent gir nøyaktig samme dag som ett som kom fram med en gang.

Helsedata for søvn brukes ikke. `HKCategoryTypeIdentifier.sleepAnalysis` krever at
Ole faktisk sporer søvn, og skrives ofte først en god stund etter oppvåkning — det
er dårligere enn begge signalene over på begge akser.

## Flaten

Bolkene tegnes i `DayCalendar` sammen med avtalene, men visuelt atskilt — en
avtale og en bolk er ikke samme slags ting, og skal ikke kunne forveksles på en
vegg man ser på i forbifarten.

Er oppvåkningen oppdaget og ikke bekreftet, står det en stripe over dagen:
«Regnet med at du sto opp 09:40 — ikke riktig?», med et felt for å rette
tidspunktet. Panelet skal aldri stokke om dagen på et gjett uten at det er synlig
at gjettet er tatt. Retter Ole tidspunktet, skrives det som `manual` og dagen
legges ut på nytt umiddelbart.

`dropped` listes nederst under dagen, som «dette rakk du ikke i dag». Lista er
lesning; den flytter ikke noe til i morgen av seg selv.

## Feilhåndtering

- Finnes ingen mal, oppfører panelet seg nøyaktig som i dag. Dagsplanen er et
  tillegg, og fraværet av den er ikke en feiltilstand.
- Finnes ingen oppvåkning for dagen, legges malen ut fra `wakeAnchor`. Det er den
  planen Ole selv skrev, og den er riktig helt til noe sier noe annet.
- Er kalenderen nede, er `anchors` tom. Bolkene legges ut uten ankre, og stripa
  sier at avtalene mangler — en plan uten ankre er verre enn ingen plan hvis den
  presenteres som fullstendig.
- `POST /api/wake` avviser et tidspunkt som ikke er i dag, og et som ligger fram i
  tid. Begge deler betyr at noe er galt i kilden, ikke at Ole sto opp i morgen.

## Testing

Nye tester i `tests/dashboard.test.mjs` for `planDay`, kjørt av `npm test`:

- ingen skyving når `wokeAt` er lik `wakeAnchor`
- ingen skyving når `wokeAt` er tidligere enn `wakeAnchor`
- alle bolker skjøvet like langt når det ikke finnes ankre
- bolk som treffer et anker legges etter ankeret, ikke oppå
- bolk som ikke får plass før `dayEnd` havner i `dropped`
- kortere bolk etter en droppet bolk får fortsatt plass
- heldagsavtale teller ikke som anker

Ny testfil `tests/wake.test.mjs` for endepunktet: avvist tidspunkt fram i tid,
avvist dato som ikke er i dag, `manual` overskrives ikke av `usage`.

## Kjent begrensning

Mac-en sover — `pmset` melder `sleep 1` og `womp 0`, så den kan heller ikke vekkes
over nettverket. Ligger Ole i senga med telefonen, når han ikke panelet før Mac-en
er oppe, og det gjelder allerede i dag for hele panelet.

Denne spec-en fikser ikke det. Den sørger for at oppvåkningen ikke går tapt mens
Mac-en sover, slik at dagen er riktig i det panelet åpnes. Å se planen i senga
krever at den bor utenfor Mac-en, og det er et eget prosjekt med sin egen spec.
