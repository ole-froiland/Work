#!/bin/bash
# Bygger og installerer Panelkobling på en tilkoblet iPhone.
# Koble telefonen til med kabel, lås den opp, og kjør skriptet.
set -euo pipefail

cd "$(dirname "$0")"
DERIVED=${DERIVED_DATA:-build/device}

# Simulatorer meldes som transportType "sameMachine", og en fysisk telefon som
# ikke er tilkoblet har ingen transport i det hele tatt. Bare en ekte, tilkoblet
# iPhone har begge deler.
device_id() {
  xcrun devicectl list devices --json-output /dev/stdout 2>/dev/null \
    | python3 -c '
import json, sys
try:
    devices = json.load(sys.stdin).get("result", {}).get("devices", [])
except Exception:
    sys.exit(0)
for device in devices:
    hardware = device.get("hardwareProperties", {})
    connection = device.get("connectionProperties", {})
    transport = connection.get("transportType")
    if hardware.get("platform") != "iOS" or hardware.get("deviceType") != "iPhone":
        continue
    if not transport or transport == "sameMachine":
        continue
    print(device.get("identifier", ""))
    break
'
}

DEVICE=$(device_id)
if [ -z "$DEVICE" ]; then
  echo "Fant ingen tilkoblet iPhone." >&2
  echo "Koble telefonen til med kabel, lås den opp, og svar «Stol på denne maskinen»." >&2
  exit 1
fi

echo "Enhet: $DEVICE"
command -v xcodegen >/dev/null || { echo "xcodegen mangler: brew install xcodegen" >&2; exit 1; }
xcodegen generate --spec project.yml >/dev/null

echo "Bygger …"
xcodebuild -project PanelCompanion.xcodeproj -scheme PanelCompanion \
  -destination "id=$DEVICE" -derivedDataPath "$DERIVED" \
  build >/dev/null

APP=$(find "$DERIVED/Build/Products" -maxdepth 2 -name "*.app" -type d | head -1)
[ -n "$APP" ] || { echo "Fant ingen bygget app under $DERIVED" >&2; exit 1; }

echo "Installerer $(basename "$APP") …"
xcrun devicectl device install app --device "$DEVICE" "$APP"
xcrun devicectl device process launch --device "$DEVICE" no.olefroiland.PanelCompanion

echo
echo "Ferdig. Appen er åpnet på telefonen og synker i forgrunnen med én gang."
echo "Godkjenn Helse- og posisjonstilgang hvis den spør, og la Bakgrunnsoppdatering"
echo "stå på i Innstillinger → Generelt → Bakgrunnsoppdatering."
