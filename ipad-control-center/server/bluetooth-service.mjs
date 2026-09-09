// Hodetelefonene står fast på én enhet, og veien ut har vært å slå dem av og på
// til de finner riktig sted. Mac-en kan gjøre det samme med ett kall.
//
// `IOBluetooth` er et offentlig rammeverk, og JXA når det gjennom `osascript` —
// samme bro som resten av Mac-handlingene bruker. Derfor ingen `blueutil` og
// ingen ny avhengighet for en funksjon som ellers ville stått og falt med at
// Homebrew var i orden.
//
// Det Mac-en *ikke* kan, er å få iPaden eller iPhonen til å koble seg til noe.
// En Bluetooth-forbindelse startes av enheten som vil ha lyden, og det finnes
// ikke noe API for å be en annen enhet gjøre det. Derfor er «koble fra Mac-en»
// like viktig som «koble til»: det er den som slipper hodetelefonene videre.

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const runCommand = promisify(execFile);

// Klassekoden og ikke en navneliste: en ny hodetelefon skal dukke opp i arket
// uten at noen må skrive den inn først. Major 4 er lyd og bilde; av de minor-
// kodene der er det headset (1), håndfri (2) og hodetelefoner (6) som er verdt
// en rad. TV-en (14) og høyttalere hører ikke hjemme i et ark om hodetelefoner.
const AUDIO_MAJOR = 4;
const HEADPHONE_MINORS = new Set([1, 2, 6]);

// Tilkoblingen tar tid — hodetelefonen må våkne, svare og forhandle. Ti sekunder
// er nok til at en AirPod i etuiet rekker å gi opp, og kort nok til at panelet
// ikke ser ut som det har hengt seg.
const CONNECT_TIMEOUT_MS = 12_000;
// Hvor lenge skriptet selv venter på at enheten skal stå tilkoblet. Den må ligge
// godt innenfor grensen over, ellers drepes skriptet før det rekker å svare.
const SETTLE_MS = 7_000;
const LIST_TIMEOUT_MS = 6_000;

const LIST_SCRIPT = `
ObjC.import("IOBluetooth");
function run() {
  var host = $.IOBluetoothHostController.defaultController;
  var power = host ? host.powerState : 0;
  var paired = $.IOBluetoothDevice.pairedDevices;
  var devices = [];
  if (paired) {
    for (var i = 0; i < paired.count; i++) {
      var d = paired.objectAtIndex(i);
      devices.push({
        name: ObjC.unwrap(d.nameOrAddress),
        address: ObjC.unwrap(d.addressString),
        connected: d.isConnected ? true : false,
        major: d.deviceClassMajor,
        minor: d.deviceClassMinor,
      });
    }
  }
  return JSON.stringify({ power: power, devices: devices });
}
`;

// Adressen kommer inn som argument og aldri som tekst i skriptet. Samme regel
// som Chrome-adressene følger: det som kommer utenfra skal ikke kunne bli kode.
const SWITCH_SCRIPT = `
ObjC.import("Foundation");
ObjC.import("IOBluetooth");
function flat(value) {
  return String(value == null ? "" : value).toLowerCase().replace(/[^0-9a-f]/g, "");
}
function run(argv) {
  var wanted = flat(argv[0]);
  var mode = argv[1];
  var waitMs = Number(argv[2]) || 7000;
  var paired = $.IOBluetoothDevice.pairedDevices;
  var found = null;
  if (paired) {
    for (var i = 0; i < paired.count && !found; i++) {
      var d = paired.objectAtIndex(i);
      if (flat(ObjC.unwrap(d.addressString)) === wanted) found = d;
    }
  }
  if (!found) return JSON.stringify({ found: false });
  var code;
  if (mode === "connect") {
    // \`openConnection\` finnes i flere utgaver, og da gir JXA tilbake selve
    // funksjonen i stedet for a kalle den. Uten parentesene her ble knappen
    // aldri annet enn et funksjonsobjekt som JSON kastet bort, og tilkoblingen
    // kjorte ikke en eneste gang.
    code = found.openConnection(null);
  } else {
    // \`closeConnection\` finnes bare i en utgave, og da kaller JXA den ved
    // selve oppslaget. Parenteser her ville prove a kalle et tall.
    code = found.closeConnection;
  }
  // Koden sier bare at forespørselen ble tatt imot: en hodetelefon som ligger i
  // etuiet svarer ogsa 0. Fasiten er om den star tilkoblet etterpa, sa vi lar
  // kjøresløyfa gå til den gjør det eller til tiden er ute.
  var want = mode === "connect";
  var until = $.NSDate.dateWithTimeIntervalSinceNow(waitMs / 1000);
  while ((found.isConnected ? true : false) !== want && $.NSDate.date.compare(until) < 0) {
    $.NSRunLoop.currentRunLoop.runUntilDate($.NSDate.dateWithTimeIntervalSinceNow(0.25));
  }
  return JSON.stringify({
    found: true,
    name: ObjC.unwrap(found.nameOrAddress),
    address: ObjC.unwrap(found.addressString),
    code: typeof code === "number" ? code : null,
    connected: found.isConnected ? true : false,
  });
}
`;

// Adressen er identiteten til enheten hele veien gjennom panelet, så den skal
// se lik ut uansett hvor den kom fra. IOBluetooth skriver den med bindestrek og
// små bokstaver, system_profiler med kolon og store.
export function normalizeAddress(value) {
  const flat = String(value ?? "").toLowerCase().replace(/[^0-9a-f]/g, "");
  if (flat.length !== 12) return null;
  return flat.match(/.{2}/g).join("-");
}

export function isHeadphone(device) {
  return device?.major === AUDIO_MAJOR && HEADPHONE_MINORS.has(device?.minor);
}

// Parsingen ligger for seg selv slik at testene når den uten en Mac. Alt som
// kommer fra skriptet behandles som ukjent: en enhet uten brukbar adresse er en
// enhet panelet ikke kan koble til igjen, og da er den bedre ute av lista.
export function readBluetoothSnapshot(stdout) {
  let parsed = null;
  try {
    parsed = JSON.parse(String(stdout ?? "").trim());
  } catch {
    return { ok: false, powered: false, error: "Fikk ikke lest Bluetooth-enhetene på Mac-en", devices: [] };
  }
  const powered = parsed?.power === 1;
  const devices = Array.isArray(parsed?.devices) ? parsed.devices : [];
  return {
    ok: true,
    powered,
    // Er Bluetooth avslått, er lista tom av en grunn panelet kjenner. Da skal
    // arket si det i stedet for å se ut som at ingenting er paret.
    error: powered ? null : "Bluetooth er slått av på Mac-en",
    devices: devices
      .filter(isHeadphone)
      .map((device) => ({
        id: normalizeAddress(device.address),
        name: String(device.name ?? "").trim() || "Ukjent enhet",
        onMac: Boolean(device.connected) && powered,
      }))
      .filter((device) => device.id)
      .sort((a, b) => Number(b.onMac) - Number(a.onMac) || a.name.localeCompare(b.name, "nb")),
  };
}

// Returkoden sier bare at forespørselen ble tatt imot — en hodetelefon som
// ligger i etuiet svarer også 0 — så dommen felles på om enheten faktisk står
// tilkoblet etterpå. Koden blir med som detalj når den finnes, og utelates når
// den ikke gjør det: «kode undefined» hjelper ingen.
function detail(code) {
  return Number.isFinite(code) ? ` (kode ${code})` : "";
}

export function describeSwitch(result, mode) {
  if (!result?.found) return { ok: false, error: "Enheten er ikke lenger paret med Mac-en" };
  const name = result.name || "Enheten";
  if (mode === "connect") {
    if (result.connected) return { ok: true, name, onMac: true, message: `${name} er koblet til Mac-en` };
    return {
      ok: false,
      name,
      onMac: false,
      error: `Fikk ikke kontakt med ${name}. Er den slått på og ute av etuiet?${detail(result.code)}`,
    };
  }
  if (!result.connected) return { ok: true, name, onMac: false, message: `${name} er koblet fra Mac-en` };
  return { ok: false, name, onMac: true, error: `${name} slapp ikke taket i Mac-en${detail(result.code)}` };
}

export async function listHeadphones({ exec = runCommand } = {}) {
  try {
    const { stdout } = await exec("osascript", ["-l", "JavaScript", "-e", LIST_SCRIPT], { timeout: LIST_TIMEOUT_MS });
    return readBluetoothSnapshot(stdout);
  } catch (error) {
    return {
      ok: false,
      powered: false,
      error: `Fikk ikke lest Bluetooth på Mac-en (${String(error?.message ?? "osascript svarte ikke").split("\n")[0]})`,
      devices: [],
    };
  }
}

export async function switchHeadphone({ address, mode, exec = runCommand } = {}) {
  const id = normalizeAddress(address);
  if (!id) throw new Error("Ugyldig Bluetooth-adresse");
  if (mode !== "connect" && mode !== "disconnect") throw new Error("Ukjent Bluetooth-handling");
  let parsed = null;
  try {
    const { stdout } = await exec("osascript", ["-l", "JavaScript", "-e", SWITCH_SCRIPT, id, mode, String(SETTLE_MS)], { timeout: CONNECT_TIMEOUT_MS });
    parsed = JSON.parse(String(stdout).trim());
  } catch (error) {
    const line = String(error?.message ?? "").split("\n")[0];
    // En tidsavbrutt tilkobling er den vanligste feilen, og den ser helt annerledes
    // ut for den som står med hodetelefonene i hånda enn «osascript feilet».
    if (error?.killed) throw new Error("Enheten svarte ikke i tide. Er den slått på og ute av etuiet?");
    throw new Error(`Bluetooth-kallet feilet (${line || "osascript svarte ikke"})`);
  }
  const verdict = describeSwitch(parsed, mode);
  if (!verdict.ok) throw new Error(verdict.error);
  return { id, ...verdict };
}
