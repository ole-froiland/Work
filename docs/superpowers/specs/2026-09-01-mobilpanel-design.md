# Mobilpanel — design

Panelet er bygget for en iPad i landskap som henger på veggen. Ole har nå et
feste til iPhonen ved siden av Mac-en, og vil ha panelet der også. Den samme
flaten presset ned i 375 px blir ikke et mobilpanel — kolonnene stables, all
tekst krymper, og et døgn i timerutenett blir uleselig. Mobilen trenger sine
egne sider.

## Hva den skal svare på

Telefonen står ved siden av Mac-en, en armlengde unna, og blir sett på i
forbifarten. Den skal svare på tre ting, i denne rekkefølgen:

1. Hva gjør jeg nå, hva er det neste, og hva spilles?
2. Hvordan ser resten av dagen ut?
3. Går alt som det skal — kvoter, agenter, kropp, tilkobling?

## Hvordan mobilvisningen velges

`chooseLayout({ location, storage, matchMedia })` i `src/dashboard.js`, en ren
funksjon som `main.jsx` kaller etter at `planPanelEntry` har gjort sitt.
Netlify-hoppet er uendret: telefonen går samme vei som iPad-en, og på mobildata
er tailnett-navnet det eneste som svarer.

Rekkefølgen:

1. `?layout=mobil` eller `?layout=ipad` vinner, og lagres under `panelLayout`.
2. Ellers det som er lagret.
3. Ellers: mobil når kortsiden er 500 px eller mindre **og** `(pointer: coarse)`.

Grensen er satt under iPad-ens korteste side (768 px), slik at en iPad i portrett
aldri havner i mobilvisningen. `pointer: coarse` holder et smalt nettleservindu
på Mac-en utenfor.

## Kodedeling

Datalaget skal ikke finnes i to utgaver. Tre uttrekk fra `App.jsx`, uten at
iPad-visningen endrer seg:

- `src/panel-data.js` — `usePolledResource` og `readJsonResponse` flyttes hit.
- `src/spotify-client.js` — `useSpotify()`: polling med tempo etter tilstand,
  lokal framdriftstelling mellom hentingene, kommandoer, enhetsliste.
  `NowPlayingCard` blir en visning over hooken; mobilens musikkort bruker den
  samme.
- `src/mac-action.js` — `callMacAction()`, den ene POST-en `App.jsx` i dag gjør
  tre steder hver for seg.

Kalenderreglene, dagsplanen, fagkodene og formateringen ligger allerede i
`dashboard.js` og brukes rett fra mobilen.

## Sidene

**NÅ**
- Klokke og dato, stort nok til å leses i forbifarten
- Akkurat nå: avtalen som pågår, med fagknapp der faget er koblet opp
- Neste aktivitet med nedtelling
- Musikk: cover, spor, artist, framdrift, forrige/spill/neste, enhetsvelger
- Fokusøkt: aktivitet, nedtelling, start/pause/hopp
- Knapperad: Fokus av/på, Skjermspeiling, Skole, Skjerm våken

**DAGEN**
- Dagens avtaler som loddrett liste. Ikke timerutenett: 375 px tåler ikke et
  døgn i rutenett, og listen sier det samme uten å be om zooming.
- Den skjøvede planen fra `planCalendarDay`, med avhuking som på iPad-en
- «Falt ut»-lista, det som ikke fikk plass før `dayEnd`
- Piler for i går og i morgen

**STATUS**
- AI-bruk: gjenstående prosent og nullstillingstid for Codex og Claude
- De tre nyeste agent-øktene
- Skritt, sosiale medier, søvn, vær
- Tilkoblingsradene, med samme ett-trykks reparasjon

## Navigasjon

Tre faner nederst, over hjemindikatoren, innen tommelrekkevidde. Vannrett sveip
gjør det samme. Sveipet starter ikke i de 20 px nærmest venstre skjermkant:
der eier Safari gesten, og en side som kjemper om den taper. Valgt side huskes
i `sessionStorage`, slik at et panel som står i festet kommer tilbake der det
sto.

## Stil

`src/mobile.css`, en egen fil som arver fargevariablene fra `styles.css`.
`styles.css` røres ikke — iPad-panelet skal ikke kunne endre seg av dette.
Egne mål: 16 px brødtekst, 44 px trykkflater, sikkerhetssone i topp og bunn.

Skjerm våken bruker den samme `createScreenWakeLockController` som iPad-panelet,
men er av som standard. En telefon som står og lyser uten lader er tom før
kvelden.

## Tomme tilstander

Samme regel som ellers i panelet: aldri finn på verdier. Mangler en kilde, sier
kortet hvorfor, med telefonens egne ord der de finnes. Mobilpanelet er like
avhengig av at Mac-en er våken som iPad-panelet — med lokket lukket viser det
ingenting, og skal si det.

## Verifisering

- `tests/mobile-layout.test.mjs`: `chooseLayout` — overstyring vinner og huskes,
  lagret valg brukes, iPad i portrett velger ikke mobil, smalt Mac-vindu velger
  ikke mobil.
- `npm test` og `npm run build` må gå gjennom. Uttrekkene over er det som kan
  brekke noe.
- Panelet kjøres og ses på i mobilbredde før arbeidet regnes som ferdig.
