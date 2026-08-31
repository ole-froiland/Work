import test from "node:test";
import assert from "node:assert/strict";

import { MAX_CLIPBOARD_BYTES, normalizeClipboardPayload, readMacClipboard, writeMacClipboard } from "../server/clipboard-service.mjs";
import { describeMacClipboard, writePhoneClipboard } from "../src/clipboard-bridge.js";

const ettPiksels = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

function fakeExec(svar = {}) {
  const kall = [];
  const exec = async (command, args) => {
    kall.push({ command, args });
    const handler = svar[command];
    if (typeof handler === "function") return handler(args);
    return { stdout: "", stderr: "" };
  };
  return { exec, kall };
}

test("tekst og bilde slipper gjennom, resten avvises", () => {
  assert.deepEqual(normalizeClipboardPayload({ kind: "text", text: "hei" }), { kind: "text", text: "hei" });
  const bilde = normalizeClipboardPayload({ kind: "image", dataUrl: `data:image/png;base64,${ettPiksels}` });
  assert.equal(bilde.kind, "image");
  assert.equal(bilde.mediaType, "image/png");
  assert.ok(bilde.bytes.length > 0);

  assert.throws(() => normalizeClipboardPayload({ kind: "fil", path: "/etc/passwd" }), /Ukjent type/);
  assert.throws(() => normalizeClipboardPayload({ kind: "text", text: "" }), /tom/);
  assert.throws(() => normalizeClipboardPayload({ kind: "image", dataUrl: "data:application/pdf;base64,AAAA" }), /PNG eller JPEG/);
  assert.throws(() => normalizeClipboardPayload({ kind: "image", dataUrl: "https://example.com/bilde.png" }), /PNG eller JPEG/);
});

test("for stort utklipp avvises i stedet for å bli sendt", () => {
  const langTekst = "a".repeat(MAX_CLIPBOARD_BYTES + 1);
  assert.throws(() => normalizeClipboardPayload({ kind: "text", text: langTekst }), /for stor/);
});

// Innholdet skal aldri stå på kommandolinja: argumentlista på macOS tar slutt
// rundt én megabyte, og et utklipp er tekst vi ikke kjenner innholdet i.
test("tekst går over stdin, aldri som argument", async () => {
  const { exec, kall } = fakeExec();
  const rør = [];
  await writeMacClipboard({ kind: "text", text: "hemmelig passord" }, {
    exec,
    pipe: async (command, args, input) => { rør.push({ command, args, input }); },
  });
  assert.equal(kall.length, 0, "tekst skal ikke innom osascript");
  assert.deepEqual(rør, [{ command: "pbcopy", args: [], input: "hemmelig passord" }]);
});

// AppleScript la teksten på tavla i Mac Roman: «—» ble til ett byte i stedet
// for tre. Tegnsettet er hele grunnen til at tekst ikke går den veien.
test("tegn utenfor ASCII overlever veien til Mac-en", async () => {
  const { exec } = fakeExec();
  let sendt = null;
  const tekst = "Panel — æøå · 100 %";
  await writeMacClipboard({ kind: "text", text: tekst }, { exec, pipe: async (c, a, input) => { sendt = input; } });
  assert.equal(sendt, tekst);
  assert.equal(Buffer.from(sendt, "utf8").length, Buffer.from(tekst, "utf8").length);
});

test("et JPEG gjøres om til PNG før det legges på utklippstavla", async () => {
  const { exec, kall } = fakeExec();
  const jpeg = normalizeClipboardPayload({ kind: "image", dataUrl: `data:image/jpeg;base64,${ettPiksels}` });
  await writeMacClipboard(jpeg, { exec });
  assert.equal(kall[0].command, "sips");
  assert.deepEqual(kall[0].args.slice(0, 3), ["-s", "format", "png"]);
  assert.ok(kall[1].args.join(" ").includes("«class PNGf»"));
});

test("et PNG går rett videre uten konvertering", async () => {
  const { exec, kall } = fakeExec();
  const png = normalizeClipboardPayload({ kind: "image", dataUrl: `data:image/png;base64,${ettPiksels}` });
  await writeMacClipboard(png, { exec });
  assert.equal(kall.length, 1);
  assert.equal(kall[0].command, "osascript");
});

test("feiler Mac-en, kommer grunnen med tilbake", async () => {
  const { exec } = fakeExec();
  await assert.rejects(
    writeMacClipboard({ kind: "text", text: "hei" }, {
      exec,
      pipe: async () => { throw Object.assign(new Error("boom"), { stderr: "pbcopy: Ikke tillatt" }); },
    }),
    /Ikke tillatt/,
  );

  const png = normalizeClipboardPayload({ kind: "image", dataUrl: `data:image/png;base64,${ettPiksels}` });
  const feilende = fakeExec({ osascript: () => { throw Object.assign(new Error("boom"), { stderr: "execution error: Nektet tilgang" }); } });
  await assert.rejects(writeMacClipboard(png, { exec: feilende.exec }), /Nektet tilgang/);
});

test("tekst på Mac-en vinner over bildeforsøket", async () => {
  const { exec, kall } = fakeExec({ pbpaste: () => ({ stdout: "kopiert på Mac-en" }) });
  assert.deepEqual(await readMacClipboard({ exec }), { ok: true, kind: "text", text: "kopiert på Mac-en" });
  assert.equal(kall.length, 1, "osascript skal ikke kjøres når pbpaste svarte");
});

// Et bilde gir tom pbpaste. Uten bildeforsøket etterpå ville et kopiert bilde
// kommet tilbake som en tom streng, altså som «ingenting».
test("tom tekst betyr ikke tom utklippstavle", async () => {
  const { exec, kall } = fakeExec({ pbpaste: () => ({ stdout: "" }) });
  const svar = await readMacClipboard({ exec });
  assert.equal(kall[1].command, "osascript");
  // Fake-exec skriver ingen fil, så bildelesingen ender i «ingenting å hente».
  assert.deepEqual(svar, { ok: true, kind: "empty" });
});

test("raden sier hva som faktisk ligger klart", () => {
  assert.equal(describeMacClipboard(null), "Henter …");
  assert.equal(describeMacClipboard({ kind: "empty" }), "Ingenting på Mac-ens utklippstavle");
  assert.equal(describeMacClipboard({ kind: "image" }), "Et bilde ligger klart");
  assert.equal(describeMacClipboard({ kind: "text", text: "\n\nførste linje\nandre" }), "første linje");
  assert.equal(describeMacClipboard({ kind: "text", text: "x".repeat(80) }), `${"x".repeat(48)}…`);
});

// «Failed to execute \'write\' on \'Clipboard\': Document is not focused» sier
// ingenting om hva Ole skal gjøre. Det ene som hjelper er å trykke på panelet.
test("nettleserens nei blir til noe man kan gjøre noe med", async () => {
  const nektet = Object.assign(new Error("Document is not focused"), { name: "NotAllowedError" });
  await assert.rejects(
    writePhoneClipboard({ kind: "text", text: "hei" }, { clipboard: { writeText: async () => { throw nektet; } } }),
    /Trykk én gang på panelet/,
  );
});

test("en tom Mac-tavle er ikke noe å legge på telefonen", async () => {
  await assert.rejects(writePhoneClipboard({ kind: "empty" }, { clipboard: {} }), /tom/);
});

test("uten bildestøtte sier raden det, i stedet for å feile stille", async () => {
  await assert.rejects(
    writePhoneClipboard({ kind: "image", dataUrl: "data:image/png;base64,AAAA" }, { clipboard: { writeText: async () => {} }, ClipboardItemImpl: null }),
    /bare ta imot tekst/,
  );
});
