# Panel

Et touchvennlig iPad-dashbord for kalender, fokus, oppgaver og handlinger på en Mac. Prototypen fyller skjermen uten vertikal rulling og kan sende hurtighandlinger til en valgfri lokal Mac-bro.

AI-brukskortet henter leverandørrapporterte kvotetall fra de lokale, innloggede Codex- og Claude-klientene. Det viser brukt og gjenstående prosent, eksakt nullstillingstid og en løpende nedtelling. Codex-dagsbruk kommer fra kontoens dagsdata. Claude-dagsbruk er eksakte, dedupliserte tokens registrert av Claude Code lokalt og merkes derfor «lokalt». Kortet oppdateres automatisk hvert minutt og kan oppdateres manuelt. Tilgangstokener leses fra macOS Nøkkelring på Mac-en og sendes aldri til nettleseren.

## Kjør lokalt

```bash
npm install
npm run dev
```

På iPad og andre enheter på samme nettverk brukes den stabile lokale adressen
`http://Ole-sin-MacBook-Air.local:4173`. Denne adressen gir tilgang til de private
Mac-funksjonene. Den offentlige Netlify-utgaven viser grensesnittet, men kjører av
sikkerhetsgrunner ikke Mac-handlinger eller leser lokale konto- og helsedata.

Mac-en bruker LaunchAgent-filen i `macos/com.ole.panel.plist`, slik at den lokale
broen starter ved innlogging og startes på nytt automatisk hvis prosessen stopper.

Codex og Claude må være installert og innlogget på Mac-en som kjører serveren. Hvis én klient ikke er tilgjengelig, viser panelet en eksplisitt feil for den leverandøren i stedet for et estimat.

## Vær, skjermtid og skritt

Været hentes automatisk fra Open-Meteo. Panelet bruker bare en fersk Core Location-posisjon fra iPhone/iPad-koblingen og faller ellers tilbake til Mosterøy. Mac- eller nettleserposisjon brukes ikke. Værdata oppdateres hvert minutt i grensesnittet og mellomlagres i ti minutter på serveren.

En vanlig nettside får ikke lese Apples Skjermtid- eller Helsedata direkte. Derfor viser panelet `Ikke synket` fremfor å finne på verdier. Den lokale iOS-appen i `ios-companion/` henter skritt fra HealthKit, posisjon fra Core Location og skjermtid fra Device Activity. Alle kildene krever eksplisitt tillatelse på mobilen.

Skjermtidseksport er Apples nye EU-funksjon for iOS 26.4+. Prosjektet aktiverer koden automatisk når det bygges med iPhoneOS 26.4 SDK eller nyere. Skritt og lokasjon bygger allerede med SDK 26.2. Mac-en må ha et Apple-utviklersertifikat før appen kan signeres og installeres på en fysisk iPhone.

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
