# Hodetelefonene dit du er

## Problemet

Ole bytter mellom AirPods og et Sony WH-1000XM5, og mellom Mac, iPhone og iPad.
Byttet er tungvint: hodetelefonene står fast på én enhet, og veien ut er å slå
dem av og på igjen til de finner riktig sted. Panelet henger uansett foran ham
mens dette skjer, så knappen hører hjemme der.

## Hva som faktisk er mulig

Dette er hele grunnen til at designet ser ut som det gjør, så det står først.

Mac-en kan lese alle parede enheter og se hvilke som er tilkoblet, og den kan
koble sine egne til og fra. `IOBluetooth` er et offentlig rammeverk, og JXA når
det gjennom `osascript` — samme bro som resten av Mac-handlingene bruker. Ingen
nye avhengigheter.

Mac-en kan **ikke** få iPaden eller iPhonen til å koble seg til noe. En
Bluetooth-forbindelse startes av enheten som vil ha lyden, og det finnes ikke
noe API for å be en annen enhet gjøre det. Mac-en når heller ikke telefonen i
det hele tatt — den pusher via `BGTaskScheduler` og kan ikke kalles på.

På telefonen selv er den ene veien en iOS-snarvei med «Angi avspillingsmål»,
startet fra panelet med `shortcuts://run-shortcut`. Den virker bare på enheten
man holder i.

«Flere samtidig» er en egenskap ved hodetelefonene, ikke ved panelet: AirPods
holder én enhet av gangen og hopper automatisk, mens XM5 har multipoint og kan
stå på to. Panelet skal si dette, ikke love noe annet.

## Flaten

En sjette hurtigknapp på Nå-siden, «Lyd», ved siden av Fokus. Fokus blir
stående — den gjør noe annet, og Ole bruker den.

Knappen åpner et ark, samme mønster som Utklipp og Spotify-enhetsvelgeren.
Arket er en liste man peker i, ikke et skjema man leser: først hvilken
hodetelefon, så hvor den skal. Trykk på en hodetelefon bytter arket til målene —
Mac-en, telefonen, iPaden — og trykk på et mål er hele handlingen.

Den første utgaven la begge veiene og hele forklaringen ut i samme rad. Da var
arket mest tekst, og man leste seg fram til en knapp i stedet for å peke på den.
Oppskriften på snarveien hører hjemme der man setter den opp, én gang, og ingen
andre steder.

Lista er parede enheter av Bluetooth-klasse hodetelefon eller headset. Mus,
tastatur, TV, iPad og iPhone faller bort av seg selv; filteret er klassekoden og
ikke en navneliste, slik at en ny hodetelefon dukker opp uten at noen må skrive
den inn.

## De to veiene

**Til Mac-en** går over `/api/mac-action` som resten av broen. Står enheten
allerede på Mac-en, snur knappen til «Koble fra Mac-en» — det er den som slipper
hodetelefonene til telefonen, og den er halve poenget med arket.

**Til telefonen** starter en snarvei Ole lager én gang per hodetelefon.
Panelet husker navnet under `panel-bt-shortcut-<adresse>` i `localStorage`.
Uten et lagret navn sier målet «Trykk for å sette opp» og fører til oppsettet i
stedet for å gjøre noe: panelet skal aldri tilby en knapp som ikke fører noe
sted, og en `shortcuts://`-adresse til en snarvei som ikke finnes ender i en
feilmelding fra Snarveier-appen. En snarvei kan få nytt navn senere, så veien
tilbake til oppsettet finnes — men bare når det er noe å endre.

**iPaden** står i lista og er avslått, med «Kan ikke styres herfra» under seg.
Å skjule den ville latt som om målet ikke finnes; avslått med grunnen skrevet
svarer på hvorfor. Spotify-arket viser en enhet det ikke kan styre på samme måte.

## Statusen

Raden kan si «På Mac-en» og «Av». Den kan ikke si «På telefonen» — det krever at
companion-appen rapporterer lydruten sin, altså en endring i iOS-appen og en ny
utrulling. Det ligger utenfor denne runden, og raden skal ikke gjette: står
hodetelefonen ikke på Mac-en, sier den «Ikke på Mac-en» og ikke «Av», for
panelet vet ikke om den er av eller står på telefonen.

## Serveren

`server/bluetooth-service.mjs` med tre operasjoner: liste, koble til, koble fra.
JXA-skriptet skriver JSON på stdout, og parsingen ligger i en egen ren funksjon
som testene kan nå uten en Mac.

`GET /api/bluetooth` gir lista, pollet som resten av panelet.
`bluetooth-connect` og `bluetooth-disconnect` blir to nye Mac-handlinger.

Adressen sendes alltid som argument til skriptet, aldri som tekst i det —
samme regel som Chrome-adressene følger, slik at den ikke kan tolkes som kode.

## Feil

En tilkobling som feiler skal si hvorfor. `openConnection` svarer med en
tallkode, og en hodetelefon som er slått av eller ligger i etuiet gir en annen
kode enn en Mac med Bluetooth avslått. Kodene oversettes til norsk der de er
kjente, og står som tall der de ikke er — et tall er ærligere enn en gjetning.

Er Bluetooth avslått på Mac-en, skal arket si det i stedet for å vise en tom
liste som ser ut som at ingenting er paret.
