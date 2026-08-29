# Søvnrytme som regulerer seg selv, og fem alarmer

Dato: 2026-08-29
Prosjekt: `ipad-control-center`
Bygger på: `2026-08-28-dagsplan-som-skyver-seg-design.md`

## Problemet

Dagsplanen skyver seg etter når Ole står opp, men den sier ingenting om når han
burde lagt seg. Ole vil ha en leggetid som regner seg fram selv, og som retter
seg etter hans egne tall i stedet for et tall han må sette.

Dette er en planleggingsheuristikk regnet ut fra Oles egne målinger. Det er ikke
helseråd, og spec-en påstår ingenting om hva som er sunt for folk.

## Det som allerede finnes

`WakeDetector` noterer siste gang telefonen var i bruk, under nøkkelen
`wakeLastActiveAt`. Når den oppdager en oppvåkning, er nettopp denne verdien den
siste aktiviteten *før* den lange stillheten — altså omtrent da Ole la seg.

Begge endene av natta er derfor allerede målt. Ingen ny sensor og ingen ny
handling fra Ole trengs; signalet ligger der og blir kastet i dag.

Presisjonen skal ikke overdrives. Dette er når telefonen ble lagt fra seg, ikke
når Ole sovnet. Panelet skal si «la fra deg telefonen», ikke «sovnet».

## Mål

- Leggetid og oppvåkningstid regnes ut fra Oles egne netter.
- Målet flytter seg gradvis, ikke i sprang, slik at én dårlig natt ikke river om
  på rytmen.
- Fem alarmer settes automatisk på telefonen.
- Panelet sier hvor mange netter tallet bygger på, og sier fra når det er for få.

## Ikke mål

- Ingen bruk av Apple Helse sine søvndata. De krever at Ole faktisk sporer søvn
  og skrives ofte lenge etter oppvåkning. Signalet vi har er både gratis og
  ferskere.
- Ingen oppføringer i Apple sin Klokke-app. Det finnes ingen vei dit. Alarmene
  blir Panelkoblings egne, gjennom AlarmKit.
- Ingen påstand om riktig søvnmengde. Tallet er Oles eget målte median.

## Datamodell

Nettene kan ikke utledes på nytt når de først er tapt, og hører derfor hjemme
sammen med malen, ikke i `Caches/`:
`~/Library/Application Support/ipad-control-center/sleep-history.json`

    {
      "version": 1,
      "targetWake": "08:15",
      "targetWakeDate": "2026-08-29",
      "nights": [
        { "date": "2026-08-29", "sleepAt": "...T23:41:00+02:00", "wokeAt": "...T08:52:00+02:00" }
      ]
    }

Én oppføring per dato, de siste 60 nettene. `targetWake` lagres sammen med `targetWakeDate`
fordi rampen på et kvarter per dag trenger å huske både hvor den var i går og
at den allerede har rykket i dag. Panelet poller hvert halve minutt; uten datoen
ville rampen løpt helt fram til ankeret i løpet av noen minutter.

## Utregningen

En ren funksjon i `src/dashboard.js`, ved siden av `planDay`:

    describeSleepRhythm({ nights, wakeAnchor, previousTarget, advance })
      -> { learning, nightCount, sleepNeed, targetWake, targetBedtime }

Reglene:

1. Færre enn tre netter gir `{ learning: true, nightCount }` og ingen tall.
   Et gjennomsnitt av to netter er ikke en rytme.
2. `sleepNeed` er medianen av `wokeAt − sleepAt` over nettene, klemt til mellom
   6 t og 9 t 30 min. Klemmen finnes for netter der telefonen ble liggende og
   lyse, eller ble tatt opp midt på natta — ett slikt døgn skal ikke sette
   søvnbehovet til fjorten timer.
3. `targetWake` beveger seg høyst 15 minutter per dag fra `previousTarget` mot
   `wakeAnchor` i dagsmalen. Uten `previousTarget` starter den på medianen av
   Oles faktiske oppvåkninger — der han er, ikke der han vil være.
4. `targetBedtime` er `targetWake − sleepNeed − 15 min`. Kvarteret er tiden det
   tar å sovne etter at lyset er slukket.

Ankeret er `wakeAnchor` fra dagsmalen, altså tidspunktet Ole selv har skrevet at
dagen skal begynne. Målet trekker mot det Ole har sagt han vil, ikke mot et tall
denne koden har funnet på.

## Alarmene

Fem, slik Ole ba om, regnet ut av `targetBedtime` og `targetWake`:

    alarmTimes({ targetBedtime, targetWake }) -> [{ id, at, label }]

- `targetBedtime − 30 min` — «Begynn å runde av»
- `targetBedtime` — «Legg deg nå»
- `targetWake − 5 min` — «Snart opp»
- `targetWake` — «Stå opp»
- `targetWake + 5 min` — «Opp nå»

Alarmene settes av companion-appen gjennom AlarmKit, som finnes fra iOS 26 og
derfor er tilgjengelig på Oles 26.4. De bryter gjennom stillemodus og Fokus, og
de lever i Panelkobling — ikke i Klokke.

Companion henter rytmen fra `/api/day-plan` og husker den siste den fikk. Sover
Mac-en ved neste bakgrunnsoppdatering, settes alarmene fra den huskede rytmen.
Målet flytter seg høyst et kvarter om dagen, så en rytme som er et døgn gammel
er fortsatt riktig nok til å vekke på.

## Feilhåndtering

- Færre enn tre netter: panelet sier hvor mange det har, og setter ingen alarmer.
  En alarm regnet ut av to netter er verre enn ingen alarm.
- Ingen dagsmal: ingen `wakeAnchor`, og dermed intet anker å trekke mot. Da står
  `targetWake` på medianen og beveger seg ikke.
- En natt uten `sleepAt` telles ikke med i medianen, men beholdes i historikken.
  Oppvåkningen er fortsatt sann selv om leggetiden mangler.
- AlarmKit uten tillatelse: companion sier fra i sitt eget grensesnitt og prøver
  ikke igjen i bakgrunnen. En alarm som stille lot være å bli satt, er det verste
  utfallet her.

## Testing

Nye tester i `tests/dashboard.test.mjs` for `describeSleepRhythm`:

- under tre netter gir `learning: true` og ingen tall
- medianen brukes, ikke gjennomsnittet, så én skjev natt ikke drar tallet
- søvnbehov klemmes oppad og nedad
- målet flytter seg høyst 15 minutter per dag mot ankeret
- målet står stille når det allerede er på ankeret
- uten `previousTarget` starter målet på medianen av oppvåkningene
- netter uten `sleepAt` telles ikke i medianen

Og for `alarmTimes`: fem alarmer, riktige avstander, riktig rekkefølge.

## Kjent begrensning

`sleepAt` er når telefonen ble lagt fra seg. Legger Ole seg uten å ha rørt
telefonen på en time, ser natta en time lengre ut enn den var. Det finnes ingen
bedre gratis kilde, og panelet skal derfor merke tallet som et anslag hver gang
det vises.
