import test from "node:test";
import assert from "node:assert/strict";

import {
  describeSwitch,
  isHeadphone,
  listHeadphones,
  normalizeAddress,
  readBluetoothSnapshot,
  switchHeadphone,
} from "../server/bluetooth-service.mjs";

// Slik Mac-en faktisk svarer. Klassekodene er lest av Oles egne enheter, ikke
// funnet på: hodetelefoner er 4/6, Sony-headsettet 4/1, TV-en 4/14, og mus,
// tastatur, iPad og iPhone melder 0/0.
const SVAR = JSON.stringify({
  power: 1,
  devices: [
    { name: "[LG] webOS TV UP75006LF", address: "24-e8-53-31-de-9f", connected: false, major: 4, minor: 14 },
    { name: "ole bose", address: "2c-41-a1-c3-97-1f", connected: false, major: 4, minor: 6 },
    { name: "WH-1000XM5", address: "58-18-62-01-4f-bd", connected: true, major: 4, minor: 1 },
    { name: "Ole sine Airpods", address: "58-93-e8-40-f2-03", connected: false, major: 4, minor: 6 },
    { name: "MX Master 3", address: "d7-d8-9b-eb-22-07", connected: false, major: 0, minor: 0 },
    { name: "iPad (7)", address: "c4-c3-6b-70-33-d9", connected: false, major: 0, minor: 0 },
  ],
});

test("bare hodetelefoner kommer med — ikke mus, iPad eller TV", () => {
  const snapshot = readBluetoothSnapshot(SVAR);
  assert.equal(snapshot.ok, true);
  assert.equal(snapshot.powered, true);
  assert.deepEqual(snapshot.devices.map((d) => d.name), ["WH-1000XM5", "ole bose", "Ole sine Airpods"]);
});

// Filteret er klassekoden og ikke en navneliste. En ny hodetelefon skal dukke
// opp i arket uten at noen må skrive den inn først.
test("klassekoden avgjør, ikke navnet", () => {
  assert.equal(isHeadphone({ major: 4, minor: 6 }), true);
  assert.equal(isHeadphone({ major: 4, minor: 1 }), true);
  assert.equal(isHeadphone({ major: 4, minor: 14 }), false, "TV-en er ikke en hodetelefon");
  assert.equal(isHeadphone({ major: 0, minor: 0 }), false, "mus og tastatur heller ikke");
  assert.equal(isHeadphone(undefined), false);
});

test("den som står på Mac-en havner øverst", () => {
  const snapshot = readBluetoothSnapshot(SVAR);
  assert.equal(snapshot.devices[0].name, "WH-1000XM5");
  assert.equal(snapshot.devices[0].onMac, true);
  assert.equal(snapshot.devices[1].onMac, false);
});

// Er Bluetooth avslått, er lista tom av en grunn panelet kjenner. Da skal arket
// si det i stedet for å se ut som at ingenting er paret.
test("avslått Bluetooth sier hvorfor lista er tom", () => {
  const snapshot = readBluetoothSnapshot(JSON.stringify({ power: 0, devices: [] }));
  assert.equal(snapshot.powered, false);
  assert.match(snapshot.error, /slått av/);
});

// Radene ville ellers sett tilkoblet ut mens radioen var av.
test("med Bluetooth av står ingen enhet som tilkoblet", () => {
  const snapshot = readBluetoothSnapshot(JSON.stringify({
    power: 0,
    devices: [{ name: "WH-1000XM5", address: "58-18-62-01-4f-bd", connected: true, major: 4, minor: 1 }],
  }));
  assert.equal(snapshot.devices[0].onMac, false);
});

test("søppel fra skriptet gir en feil, ikke en halv liste", () => {
  const snapshot = readBluetoothSnapshot("ikke json");
  assert.equal(snapshot.ok, false);
  assert.deepEqual(snapshot.devices, []);
  assert.equal(readBluetoothSnapshot("").ok, false);
});

test("en enhet uten brukbar adresse blir ute", () => {
  const snapshot = readBluetoothSnapshot(JSON.stringify({
    power: 1,
    devices: [{ name: "Halv enhet", address: "58-93", connected: false, major: 4, minor: 6 }],
  }));
  assert.deepEqual(snapshot.devices, []);
});

test("adressen ser lik ut uansett hvor den kom fra", () => {
  assert.equal(normalizeAddress("58:18:62:01:4F:BD"), "58-18-62-01-4f-bd");
  assert.equal(normalizeAddress("58-18-62-01-4f-bd"), "58-18-62-01-4f-bd");
  assert.equal(normalizeAddress("581862014FBD"), "58-18-62-01-4f-bd");
  assert.equal(normalizeAddress("58-18-62"), null);
  assert.equal(normalizeAddress(""), null);
  assert.equal(normalizeAddress(null), null);
});

// Returkoden sier bare at forespørselen ble tatt imot — en hodetelefon som
// ligger i etuiet svarer også 0. Dommen må derfor felles på om enheten faktisk
// står tilkoblet etterpå.
test("kode 0 er ikke det samme som tilkoblet", () => {
  const dom = describeSwitch({ found: true, name: "Oles AirPods", code: 0, connected: false }, "connect");
  assert.equal(dom.ok, false);
  assert.match(dom.error, /etuiet/);
});

test("en tilkobling som tok er en tilkobling", () => {
  const dom = describeSwitch({ found: true, name: "WH-1000XM5", code: 0, connected: true }, "connect");
  assert.equal(dom.ok, true);
  assert.equal(dom.onMac, true);
  assert.match(dom.message, /koblet til Mac-en/);
});

test("frakobling måles på at den faktisk slapp", () => {
  assert.equal(describeSwitch({ found: true, name: "XM5", code: 0, connected: false }, "disconnect").ok, true);
  const sitter = describeSwitch({ found: true, name: "XM5", code: 0, connected: true }, "disconnect");
  assert.equal(sitter.ok, false);
  assert.match(sitter.error, /slapp ikke taket/);
});

// «kode undefined» hjelper ingen.
test("en kode som mangler blir ikke skrevet ut", () => {
  const dom = describeSwitch({ found: true, name: "XM5", code: null, connected: false }, "connect");
  assert.doesNotMatch(dom.error, /kode/);
  assert.match(describeSwitch({ found: true, name: "XM5", code: 3, connected: false }, "connect").error, /kode 3/);
});

test("en enhet som er avparet sier det i stedet for å tie", () => {
  const dom = describeSwitch({ found: false }, "connect");
  assert.equal(dom.ok, false);
  assert.match(dom.error, /ikke lenger paret/);
});

// Adressen skal aldri kunne bli kode. Den stoppes før den når skriptet.
test("bare ekte adresser slipper gjennom til Mac-en", async () => {
  let kalt = false;
  const exec = async () => { kalt = true; return { stdout: "{}" }; };
  await assert.rejects(() => switchHeadphone({ address: "$(rm -rf /)", mode: "connect", exec }), /Ugyldig/);
  await assert.rejects(() => switchHeadphone({ address: "", mode: "connect", exec }), /Ugyldig/);
  await assert.rejects(() => switchHeadphone({ address: "58-18-62-01-4f-bd", mode: "slett", exec }), /Ukjent/);
  assert.equal(kalt, false, "ingenting skal ha nådd osascript");
});

test("adressen sendes som argument og aldri som tekst i skriptet", async () => {
  let sett = null;
  const exec = async (fil, args) => {
    sett = { fil, args };
    return { stdout: JSON.stringify({ found: true, name: "XM5", address: "58-18-62-01-4f-bd", code: 0, connected: true }) };
  };
  await switchHeadphone({ address: "58:18:62:01:4F:BD", mode: "connect", exec });
  assert.equal(sett.fil, "osascript");
  assert.ok(sett.args.includes("58-18-62-01-4f-bd"), "adressen skal ligge som eget argument");
  const skript = sett.args[sett.args.indexOf("-e") + 1];
  assert.doesNotMatch(skript, /58-18-62/, "skriptet skal ikke ha adressen bakt inn i seg");
});

// En Mac som sover, eller en hodetelefon som ikke svarer, skal si hvorfor.
test("en avbrutt kommando forklares med hodetelefonen, ikke med osascript", async () => {
  const exec = async () => {
    const feil = new Error("Command failed: osascript");
    feil.killed = true;
    throw feil;
  };
  await assert.rejects(
    () => switchHeadphone({ address: "58-18-62-01-4f-bd", mode: "connect", exec }),
    /svarte ikke i tide/,
  );
});

test("en lesing som feiler tar ikke ned arket", async () => {
  const exec = async () => { throw new Error("osascript: kommandoen finnes ikke"); };
  const snapshot = await listHeadphones({ exec });
  assert.equal(snapshot.ok, false);
  assert.deepEqual(snapshot.devices, []);
  assert.match(snapshot.error, /Fikk ikke lest Bluetooth/);
});
