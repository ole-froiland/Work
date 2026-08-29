# Fagknappen: fra «BUS400N om fem minutter» til en plan i ChatGPT

Dato: 2026-08-29
Prosjekt: `ipad-control-center`

## Problemet

Panelet forteller Ole at neste økt er BUS400N i 75 minutter. Det er alt det gjør.
Selve jobben — å åpne riktig ChatGPT-prosjekt, skrive hvor lang økta er, hvilket
fag det gjelder og hvilke frister som nærmer seg — gjør Ole for hånd, hver gang,
fem ganger i uka. Det er den samme teksten hver gang, og panelet sitter allerede
på hvert eneste tall som skal inn i den.

## Det som allerede finnes

Kalenderen skriver fagkoden i tittelen: `🔵 BUS400N – oppgaver / aktiv
gjenhenting`. Fristene ligger der også, som egne oppføringer: `📌 BUS400N –
obligatorisk innlevering 1 (frist 23:59)`. `describeCalendarActivity` regner
allerede ut hva som pågår og hva som kommer.

`chromeTargets` i `server/mac-action-service.mjs` åpner allerede adresser i
Chrome på Mac-en fra et trykk på iPaden. Mønsteret er ferdig; det som mangler er
et fag å peke på og en tekst å ta med seg.

Ole har fire ChatGPT-prosjekter: BUS400N, BUS401E, BUS446 og STR402A.

## Mål

- Ett trykk tar Ole fra kortet til et ChatGPT-prosjekt som vet hva økta er.
- Prompten er bygget av kalenderen, ikke av gjetting.
- Ingen knapp dukker opp der den ikke fører noe sted.

## Ikke-mål

- Panelet skal ikke vite «hvordan Ole ligger an» i faget. Det tallet finnes
  ingen steder panelet kan lese, og en oppdiktet framdrift er verre enn ingen.
  Prompten ber ChatGPT spørre i stedet.
- Generiske skoleøkter (`🔵 Skole – svakeste fag først`) får ingen knapp. De
  sier ikke hvilket fag det er, og en knapp som gjetter er en knapp som tar feil.

## Løsningen

### Gjenkjenning — `src/dashboard.js`

`subjectForTitle(title)` leter etter `BUS400N | BUS401E | BUS446 | STR402A` med
ordgrenser, slik at `BUS446X` ikke treffer. `describeEntry` legger resultatet på
aktiviteten som `subject`, og de to kortene får `sessionMinutes` ved siden av:
gjenstående tid når økta er i gang, full lengde når den ikke har startet. Er økta
halvveis, er det halve økta som er igjen — og det er den prompten skal si.

### Adressene — `server/subject-service.mjs`

Lenkene til prosjektene ligger i
`~/Library/Application Support/ipad-control-center/subject-projects.json`,
sammen med dagsplanen — de er skrevet av Ole og kan ikke utledes på nytt. De
ligger ikke i repoet, som er åpent.

En adresse som ikke er `https://chatgpt.com` eller `https://chat.openai.com`
slippes ikke gjennom. Uten den grensa ville en feilskrevet linje i filen kunne
sende Chrome hvor som helst.

### Knappen — `src/App.jsx`

Nettleseren spør `/api/subjects` hvilke fag som faktisk har et prosjekt. Bare
kodene svares ut; adressene blir på Mac-en. Er lista tom — fordi filen mangler,
eller fordi serveren ikke svarte — ser kortene ut nøyaktig som før. Lista hentes
på nytt ved døgnskiftet, slik at et nytt fag dukker opp av seg selv på et panel
som har hengt på veggen i tre uker.

Knappen viser bare ikonet. Fagkoden står allerede i tittelen rett over, og på en
rail som er 200 px bred er hvert tegn knappen gjentar et tegn tittelen mister.
Koden lever i knappens navn, for skjermleseren og for tooltipen.

### Trykket — `server/mac-action-service.mjs`

`subject-session` gjør tre ting, i denne rekkefølgen:

1. leser kalenderen selv, slik at fristene i prompten er de Apple Kalender har,
   ikke de nettleseren hadde da siden ble lastet,
2. legger prompten på utklippstavla,
3. åpner prosjektet i Chrome.

Rekkefølgen er hele poenget. Står ikke teksten klar når vinduet kommer fram, har
knappen spart Ole for ingenting. Feiler kalenderlesingen, bygges prompten uten
fristlista — en økt uten frister er fortsatt en økt.

ChatGPT tar ikke imot en ferdig melding i adressen, så ⌘V er det ene steget
panelet ikke kan ta for Ole. Toasten sier det rett ut i stedet for å la ham lure.

### Prompten

```
Jeg har en økt på 54 minutter i BUS400N nå.
Kalenderen sier: «🔵 BUS400N – oppgaver / aktiv gjenhenting».

Frister i BUS400N de neste tre ukene:
- 11.09 obligatorisk innlevering 1 (frist 23:59)

Legg opp økta: hva vi gjør, i hvilken rekkefølge, og hvor lenge på hver del.
Start med det som betyr mest for nærmeste frist. Spør meg hvor jeg står i faget
hvis du trenger å vite det for å prioritere.
```

Har faget ingen frister i vinduet, sier prompten det rett ut. En tom liste ville
latt ChatGPT tro at faget er à jour, når kalenderen bare er tom.

## Grenser mot ukjent inndata

Fagkoden og lengden kommer fra Mac-ens egen kalender, men går veien om
nettleseren og behandles derfor som ukjent på vei inn igjen: koden må være ett av
de fire fagene, lengden mellom ett minutt og tolv timer. Prompten sendes som
argument til `osascript`, aldri limt inn i skriptet.

## To lister som må følge hverandre

`SUBJECT_CODES` finnes i `src/dashboard.js` (nettleseren, som kjenner kodene) og
i `server/subject-service.mjs` (Mac-en, som kjenner adressene). Endres den ene,
må den andre endres i samme slengen — samme regel som applista i
`ios-companion/Sources/SocialApps.swift`.

## Det spec-en ikke løser

Kalenderen har flere skolefag enn de fire: `ETI450` (8 økter),
`🔵 R / kvantitativ metode` (8 økter) og en `📌 SKL402`-frist, i tillegg til 35
generiske `🔵 Skole – …`-økter. Ingen av dem får en knapp. Om de skal ryddes bort
eller knyttes til et av de fire fagene er et spørsmål om Oles kalender, ikke om
panelet, og hører hjemme i en egen runde.
