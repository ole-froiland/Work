# Panel

Et touchvennlig iPad-dashbord for kalender, fokus, oppgaver og handlinger på en Mac. Prototypen fyller skjermen — bare kalenderflaten rulles — og kan sende hurtighandlinger til en valgfri lokal Mac-bro.

AI-brukskortet henter leverandørrapporterte kvotetall fra de lokale, innloggede Codex- og Claude-klientene. Det viser brukt og gjenstående prosent, eksakt nullstillingstid og en løpende nedtelling. Codex-dagsbruk kommer fra kontoens dagsdata. Claude-dagsbruk er eksakte, dedupliserte tokens registrert av Claude Code lokalt og merkes derfor «lokalt». Kortet oppdateres automatisk hvert minutt og kan oppdateres manuelt. Tilgangstokener leses fra macOS Nøkkelring på Mac-en og sendes aldri til nettleseren.

Oppgavekortet rett under viser hva Claude og Codex faktisk holder på med akkurat nå: hvilke økter som kjører, hva de gjør (kjører kommandoer, endrer filer, leter på nettet), hva som har stoppet opp, og hva som er ferdig og venter på svar. Kilden er samtaleloggene klientene selv skriver på Mac-en (`~/.claude/projects` og `~/.codex/sessions`); ingenting spørres fra en leverandør, og ingen del av samtalene sendes til nettleseren utover navnet på økta og hvilket verktøy som er i bruk. Kortet leser bare slutten av hver logg og oppdateres hvert tiende sekund. En økt regnes som aktiv i fem minutter etter siste hendelse — går det lengre tid midt i en oppgave, står den merket «står stille» i stedet for å se ut som at den jobber.

## Kjør lokalt

```bash
npm install
npm run dev
```

På iPad og andre enheter på samme nettverk brukes den stabile lokale adressen
`http://Ole-sin-MacBook-Air.local:4173`. Denne adressen gir tilgang til de private
Mac-funksjonene. Netlify-adressen videresender automatisk til denne adressen, siden
den offentlige serveren av sikkerhetsgrunner ikke kan lese lokale konto- og helsedata.
Legg til `?public=1` på Netlify-adressen for å åpne det offentlige skallet ved feilsøking.

Mac-en bruker LaunchAgent-filen i `macos/com.ole.panel.plist`, slik at den lokale
broen starter ved innlogging og startes på nytt automatisk hvis prosessen stopper.
Plist-en sender ingen `--host` eller `--port`: kommandolinja overstyrer
`vite.config.mjs`, og da fantes verten to steder med hvert sitt svar. Endrer du
adresse eller port, gjør det i konfigurasjonen — testene vokter begge deler.

Serveren lytter på `::`, altså både IPv6 og IPv4. Med `0.0.0.0` tok den bare IPv4,
mens Mac-en annonserer `.local`-navnet med IPv6-adresser i tillegg — og iPad-en
velger IPv6 først. Den traff da en port ingen satt på. I Safari ser det ut som en
vanlig feilside, men et panel lagt til på Hjem-skjermen blir bare helt hvitt, uten
noe som forklarer hvorfor. Er skjermen blank, sjekk dette først:

```bash
lsof -nP -iTCP:4173 -sTCP:LISTEN
```

Står det `IPv4` der og ikke `IPv6`, kjører serveren med gammelt oppsett — last
LaunchAgent-en på nytt.

Codex og Claude må være installert og innlogget på Mac-en som kjører serveren. Hvis én klient ikke er tilgjengelig, viser panelet en eksplisitt feil for den leverandøren i stedet for et estimat.

## Vær, sosiale medier og skritt

Været hentes automatisk fra Open-Meteo. Panelet bruker bare en fersk Core Location-posisjon fra iPhone/iPad-koblingen og faller ellers tilbake til Mosterøy. Mac- eller nettleserposisjon brukes ikke. Værdata oppdateres hvert minutt i grensesnittet og mellomlagres i ti minutter på serveren.

En vanlig nettside får ikke lese Apples Skjermtid- eller Helsedata direkte. Derfor viser panelet `Ikke synket` fremfor å finne på verdier. Den lokale iOS-appen i `ios-companion/` henter skritt fra HealthKit, posisjon fra Core Location og skjermtid fra Device Activity. Alle kildene krever eksplisitt tillatelse på mobilen.

Av skjermtiden måler panelet bare sosiale medier — det er den tiden som skal ned. Telefonen summerer og sender kun appene i lista i `ios-companion/Sources/SocialApps.swift`; alt annet forlater aldri enheten. `src/dashboard.js` har den samme lista og filtrerer en gang til, i tilfelle et eldre oppsett ligger i mellomlageret. Skal en app legges til eller fjernes, må begge listene endres.

Skjermtidseksport er Apples nye EU-funksjon for iOS 26.4+. Prosjektet aktiverer koden automatisk når det bygges med iPhoneOS 26.4 SDK eller nyere. Skritt og lokasjon bygger allerede med SDK 26.2. Mac-en må ha et Apple-utviklersertifikat før appen kan signeres og installeres på en fysisk iPhone.

Installer eller reinstaller appen på telefonen. Koble iPhonen til med kabel, lås
den opp, og kjør:

```bash
./ios-companion/install-on-iphone.sh
```

Skriptet bygger, installerer og starter appen. Signeringen er låst til teamet som
eier provisioneringsprofilen (`DEVELOPMENT_TEAM` i `project.yml`), så det trengs
ingen manuelle valg i Xcode. Finner det ingen tilkoblet telefon, sier det fra i
stedet for å bygge mot en simulator.

Generer Xcode-prosjektet og kontroller at det bygger:

```bash
cd ios-companion
xcodegen generate --spec project.yml
xcodebuild -project PanelCompanion.xcodeproj -scheme PanelCompanion \
  -sdk iphonesimulator -destination 'platform=iOS Simulator,name=iPhone 17' \
  CODE_SIGNING_ALLOWED=NO build
```

Den godkjente mobilappen sender eksakte verdier til:

```json
POST /api/device-metrics
{
  "screenTime": {
    "yesterdayMinutes": 214,
    "weeklyAverageMinutes": 187
  },
  "steps": {
    "today": 6842
  },
  "location": {
    "label": "Mosterøy",
    "latitude": 59.07,
    "longitude": 5.37
  }
}
```

Appen synker i forgrunnen når den åpnes, og ellers via `BGAppRefreshTask`. Neste
bakgrunnskjøring planlegges uansett om synken lyktes. Lå kallet bare på
suksessgrenen, døde kjeden for godt første gang en synk feilet — typisk når
telefonen var utenfor hjemmenettet og `.local`-adressen ikke svarte — og appen
våknet aldri igjen av seg selv. Merk at iOS selv bestemmer når bakgrunnsjobben
kjøres; 30 minutter er tidligste tidspunkt, ikke en garanti, og jobben kjøres
ikke i det hele tatt hvis appen er tvangsavsluttet fra appbytteren.

Kortene skiller mellom «har aldri vært koblet til» og «sluttet å sende»: mangler
ferske verdier, viser de hvor lenge siden mobilen sist sendte.

Verdiene valideres sammen med kilde og observasjonstid før de lagres lokalt i `~/Library/Caches/ipad-control-center/device-metrics.json`. Panelet avviser nettleserverdier, ukjente leverandører og data som er eldre enn ett døgn. Felt som mangler, beholder sist synkroniserte verdi, men vises ikke når kilden er utdatert.

## Hurtigknapper

Fire ikonknapper øverst i venstre kolonne. To av dem kjøres direkte på Mac-en som serverer panelet, slik at de virker likt fra iPad og Mac:

```json
POST /api/mac-action
{ "action": "spotify" }
{ "action": "screen-mirror", "device": "iPad" }
{ "action": "focus-mode", "enabled": true }
```

- `spotify` åpner Spotify-appen på Mac-en, og faller tilbake til `open.spotify.com` hvis appen ikke er installert.
- `screen-mirror` kobler iPad-en til og fra som Sidecar-skjerm. Den bruker `server/sidecar-tool.m`, som bygges automatisk med `clang` ved første trykk og snakker med `SidecarCore` direkte — ingen Kontrollsenter-klikking og ingen tilgjengelighetstilgang. Enheten velges i innstillingsvinduet (standard `iPad`, kan også settes med `PANEL_MIRROR_DEVICE`) og matches mot navnet Sidecar rapporterer. Sidecar kobler til som utvidet skjerm; bytt til speiling i Skjerm-innstillingene hvis du heller vil ha det.

- `focus-mode` kjører snarveiene «Fokus på» og «Fokus av» på Mac-en (kan overstyres med `PANEL_FOCUS_ON_SHORTCUT` og `PANEL_FOCUS_OFF_SHORTCUT`). Snarveiene er allerede installert; signerte kopier ligger i `server/shortcuts/` og kan importeres på nytt ved å åpne dem. Panelet slår opp det eksakte navnet med `shortcuts list` og starter snarveien via `shortcuts://run-shortcut` — `shortcuts run` henger når den kalles fra serverprosessen. Slår du på deling av fokus på tvers av enheter i Fokus-innstillingene, følger iPhone og iPad automatisk etter. Panelet sier eksplisitt fra hvis en snarvei mangler.

Utvid/Forminsk-knappen er ren nettleser-fullskjerm.

## Musikk

Kortet rett under hurtigknappene viser sporet som spilles nå, med cover, artist og
framdrift, og har knapper for forrige, spill/pause og neste. Det bruker Spotify
Connect, så knappene treffer enheten som faktisk spiller — iPhone, Mac, iPad eller
en høyttaler — og ikke bare Spotify på Mac-en. Enhetsknappen til høyre lister alle
tilgjengelige Spotify-enheter og flytter avspillingen dit du trykker.

Panelet henter status hvert femte sekund mens noe spilles, og sjeldnere ellers.
Framdriften telles lokalt mellom hentingene. Panelet finner aldri på verdier: mangler
oppsettet, står ingen enhet aktiv, eller krever handlingen Premium, sier kortet det
rett ut.

Panelet er allerede satt opp mot Spotify-appen «Panel» (Development Mode) på kontoen
`olefroiland`. Oppsettet under trengs bare hvis tilkoblingen må lages på nytt:

1. Lag en app på [developer.spotify.com](https://developer.spotify.com/dashboard) og
   legg inn `http://127.0.0.1:4173/api/spotify/callback` som Redirect URI. Spotify
   godtar bare HTTPS eller ren loopback, derfor IP-adressen og ikke `localhost`.
   Kryss av for Web API.
2. Åpne panelinnstillingene, lim inn Client ID-en i feltet «Spotify Client ID» og
   lagre. ID-en kan også settes med `PANEL_SPOTIFY_CLIENT_ID`.
3. Trykk «Koble til Spotify» på musikkortet. Innloggingen åpnes i nettleseren på
   Mac-en, siden tilbakekallingsadressen peker på Mac-en selv. Kommandoen returnerer
   også adressen, så den kan åpnes manuelt hvis Mac-nettleseren ikke kommer fram.
   Etter innlogging virker kortet også fra iPad.

Innloggingen bruker PKCE, så det trengs ingen client secret. Client ID og
refresh-token ligger med rettighetene `0600` i
`~/Library/Caches/ipad-control-center/spotify.json` og sendes aldri til nettleseren;
panelet snakker bare med den lokale broen. Panelet ber bare om de tre tillatelsene
det trenger: `user-read-playback-state`, `user-modify-playback-state` og
`user-read-currently-playing`. Ingen tilgang til bibliotek eller spillelister.

Spotify strammet inn Development Mode i februar 2026, og det gjelder denne appen:

- **Spotify Premium er påkrevd.** Uten Premium virker ikke kortet i det hele tatt.
- **Én Client ID per utvikler**, og maks fem autoriserte brukere per app.
- **Refresh-tokenet varer 180 dager.** Etter det slutter kortet å virke og sier
  «Spotify-tilgangen er utløpt. Koble til på nytt.» Da trykker du «Koble til Spotify»
  én gang til. Regn med det rundt februar 2027.

Alle avspillingsendepunktene panelet bruker står fortsatt på Spotifys liste over
tilgjengelige endepunkter etter innstrammingen.

## Kalendernavigering

Kalenderflaten rulles loddrett og blas vannrett. Sveip til siden for å gå ett steg
frem eller tilbake i den enheten du ser på: én dag, én uke eller én måned. Pilene i
verktøylinja gjør det samme. Et sveip som ender oppå en dato åpner ikke datoen — bare
et rent trykk gjør det.

Dagsvisningen dekker hele døgnet, ikke bare 08–18. Den åpner der noe skjer: klokka nå
på dagens dato, ellers dagens første avtale, og ellers rundt sju om morgenen. Sveiper
du videre til neste dag, blir du stående på samme klokkeslett.

Et trykk på en dato i månedsvisningen åpner den dagen. Nye arrangementer lages med
«Ny» i datolinja, eller ved å dra et Sync-notat inn i kalenderen.

Ukesvisningen viser alle arrangementene i uka. De sju kolonnene deler bredden likt —
uten `min-width: 0` på `.week-day` vokser en kolonne til den lengste tittelen, og da
falt søndagen utenfor panelet.

### Rulling avslutter fullskjerm i Safari

Ruller du i kalenderen mens panelet står i Safaris fullskjerm, hopper det ut. Det er
ikke noe panelet gjør: siden iOS 15 henter et nedoversveip frem adresselinja, og den
systemgesten går foran alt en nettside gjør. Verken `touch-action`, `preventDefault`
eller egen rulling i JavaScript kommer rundt den — begge deler er prøvd og forkastet,
se `git log` rundt denne endringen.

Skal panelet stå urokkelig, er det to grep utenfor koden:

- **Legg det på Hjem-skjermen** (Del → «Legg til på Hjem-skjerm»). Da kjører det i
  standalone-modus: ingen Safari-kontroller, ingen fullskjerm å avslutte, og ingen
  sveipegest. `isStandaloneApp()` skjuler Utvid-knappen automatisk der. Statuslinja
  får sin egen stripe over panelet — `apple-mobile-web-app-status-bar-style` står på
  `black`, og `--shell-top` i `styles.css` legger sikkerhetssonen til luften rundt.
  Med `black-translucent` la iPad-en klokke, wifi og batteri rett oppå den øverste
  knapperaden.
- **Slå på Veiledet tilgang** (Innstillinger → Tilgjengelighet → Veiledet tilgang).
  Da låses iPad-en til appen, og det kreves trippelklikk og kode for å komme ut.

Sammen gir de et panel som blir stående til noen bevisst tar det ut.

Panelet sier dette selv: går du i fullskjerm fra Safari på en berøringsskjerm,
forteller det med én gang at gesten finnes og hvor man blir kvitt den. På Mac og
i standalone-modus er meldingen borte, siden den ikke gjelder der.
`public/apple-touch-icon.png` er ikonet Hjem-skjermen bruker — uten det lager iOS
et utsnitt av siden i stedet.

## Neste aktivitet

Kortet mellom Mac-snarveiene og fokusøkten henter neste avtale fra Apple Kalender og
viser navn, når den er, og hvor lenge det er til. Det har samme høyde som musikkortet
i venstre spalte — begge følger `--media-card` i `styles.css`.

Kortet svarer på «hva er det neste jeg skal», så en avtale som ennå ikke har startet
går foran en som pågår. Er det ingenting igjen på klokka, viser kortet avtalen som
pågår med sluttidspunkt, og ellers en heldagsoppføring. Nedtellingen runder nedover,
slik at den aldri viser mer tid enn du faktisk har.

## Fokusøkt

Kortet i høyre kolonne styrer en økt med aktivitet, lengde, pause og antall sett. Økt og pause veksler automatisk: en fullført økt går over i pause, og pausen går videre til neste sett til alle settene er tatt. Kortet skifter farge i pausen, og du kan pause, hoppe videre eller avslutte underveis. Aktivitet, lengder og sett huskes i nettleseren.

Bryteren «Fokus på alle enheter» kobler økten til `focus-mode`: fokus slås på når økten starter og av når den er ferdig eller avsluttes. Fokus-hurtigknappen slår det samme av og på når som helst.

Panelet kan legges til på Hjem-skjermen på iPad for å kjøre uten Safari-kontroller. Da skjules Utvid-knappen automatisk.

## Verifisering

```bash
npm test
npm run build
npm run test:sites
```
