#!/bin/bash
# Gir panelet en https-adresse gjennom Tailscale.
#
# Grunnen er utklippstavla: `navigator.clipboard` finnes bare i secure context,
# altså https eller localhost. Over http på .local og .ts.net er API-et ikke
# avvist, men helt fraværende — og da kan ikke panelet kopiere bilder til og fra
# telefonen med ett trykk, uansett hvordan knappen er skrevet.
#
# Tailscale terminerer TLS selv med et ekte Let's Encrypt-sertifikat for
# .ts.net-navnet og sender trafikken videre til panelet på loopback. Ingenting
# blir tilgjengelig utenfor tailnettet: dette er `serve`, ikke `funnel`.
set -euo pipefail

PATH="/usr/local/bin:/opt/homebrew/bin:$PATH"
SOCKET="$HOME/.tailscale/tailscaled.sock"
PORT="${PANEL_PORT:-4173}"

ts() { tailscale --socket="$SOCKET" "$@"; }

if ! ts status >/dev/null 2>&1; then
  echo "Tailscale svarer ikke. Start den med:" >&2
  echo "  launchctl kickstart -k gui/\$(id -u)/com.ole.tailscaled" >&2
  exit 1
fi

NAVN="$(ts status --json | /usr/bin/python3 -c 'import json,sys; print(json.load(sys.stdin)["Self"]["DNSName"].rstrip("."))')"

# Sertifikatet er det eneste steget som ikke kan gjøres herfra: HTTPS må slås på
# for hele tailnettet, og det er en bryter i konsollen.
# En feil her kan også være noe helt annet enn manglende sertifikater — nettet,
# en utlogget node. Da skal skriptet vise hva som faktisk sto der, ikke sende
# Ole til en bryter som allerede er på.
# `tailscale cert` nekter å skrive til /dev/null, så prøven går til en mappe som
# ryddes bort etterpå. Sertifikatet blir uansett liggende i tailscaled — det er
# der `serve` henter det fra.
PROVE="$(mktemp -d)"
trap 'rm -rf "$PROVE"' EXIT
if ! CERT_FEIL="$(ts cert --cert-file "$PROVE/cert.pem" --key-file "$PROVE/key.pem" "$NAVN" 2>&1)"; then
  if ! printf '%s' "$CERT_FEIL" | grep -qi "does not support getting TLS certs\|HTTPS.*not enabled"; then
    echo "Fikk ikke hentet sertifikat, og det er ikke fordi HTTPS er avslått:" >&2
    printf '%s\n' "$CERT_FEIL" >&2
    exit 1
  fi
  cat >&2 <<TEKST
Tailnettet har ikke HTTPS-sertifikater slått på ennå.

  1. Åpne https://login.tailscale.com/admin/dns
  2. Under «HTTPS Certificates», trykk Enable
  3. Kjør dette skriptet på nytt

Det er ett trykk, og det gjelder hele tailnettet — ingenting blir offentlig av det.
TEKST
  exit 2
fi

ts serve --bg --https=443 "http://127.0.0.1:${PORT}"

cat <<TEKST

Panelet svarer nå på:

  https://${NAVN}

Åpne den på iPhonen og legg den til på Hjem-skjermen. Det gamle ikonet peker på
http-adressen og må byttes ut — det er adressen ikonet ble laget fra som gjelder,
ikke den som er husket i Safari.

Bruker du Netlify-adressen, settes den nye verten der (og bare der — panelet selv
leser ikke ?host=):

  https://ole-work-panel.netlify.app/?host=https://${NAVN}

Utklipp-knappen får ett trykk begge veier av seg selv når adressen er https.

Slå av igjen med:  tailscale --socket=$SOCKET serve reset
TEKST
