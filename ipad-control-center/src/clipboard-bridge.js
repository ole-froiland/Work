// Broen mellom telefonens utklippstavle og Mac-ens. Universal Clipboard gjør
// det samme når den virker, men den sier ikke fra når den ikke gjør det — den
// krever Handoff, Bluetooth og samme Apple-ID, og et skjermbilde som ikke kom
// fram ser nøyaktig ut som et skjermbilde man ikke kopierte.
//
// Safari har to krav som styrer hele formen på dette:
//   1. `clipboard.read()` må skje i et trykk, og viser sin egen Lim inn-boks.
//   2. `clipboard.write()` må kalles i trykket, uten et `await` foran seg.
// Derfor hentes Mac-ens utklipp når arket åpnes, ikke når knappen trykkes.

const bildetyper = ["image/png", "image/jpeg"];

function readAsDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Fikk ikke lest bildet fra utklippstavla"));
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(blob);
  });
}

// Det telefonen har på utklippstavla, gjort om til noe som kan sendes.
export async function readPhoneClipboard({ clipboard = navigator.clipboard } = {}) {
  if (!clipboard?.read) {
    // Eldre Safari kan bare tekst. Bedre å si det enn å la knappen se ødelagt ut.
    if (!clipboard?.readText) throw new Error("Denne nettleseren gir ikke panelet tilgang til utklippstavla");
    const text = await clipboard.readText();
    if (!text) throw new Error("Utklippstavla på telefonen var tom");
    return { kind: "text", text };
  }

  let items;
  try {
    items = await clipboard.read();
  } catch (error) {
    // Avviser man Safaris egen Lim inn-boks, er det ikke en feil å rette — det
    // er et nei, og teksten skal si det i stedet for å be om feilsøking.
    throw new Error(error?.name === "NotAllowedError"
      ? "Trykk «Lim inn» i boksen Safari viser, så kommer utklippet fram"
      : `Fikk ikke lest utklippstavla (${error?.message || "ukjent grunn"})`);
  }

  for (const item of items) {
    const bilde = bildetyper.find((type) => item.types.includes(type));
    if (bilde) return { kind: "image", dataUrl: await readAsDataUrl(await item.getType(bilde)) };
  }
  for (const item of items) {
    if (!item.types.includes("text/plain")) continue;
    const text = (await (await item.getType("text/plain")).text()).trim();
    if (text) return { kind: "text", text };
  }
  throw new Error("Utklippstavla var tom, eller inneholdt noe panelet ikke kan sende");
}

export async function sendToMac(payload, { fetchImpl = globalThis.fetch } = {}) {
  const response = await fetchImpl("/api/clipboard", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.ok) throw new Error(result.error || `Mac-en svarte ikke (HTTP ${response.status})`);
  return result;
}

export async function fetchMacClipboard({ fetchImpl = globalThis.fetch } = {}) {
  const response = await fetchImpl("/api/clipboard", { cache: "no-store" });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || result.ok === false) throw new Error(result.error || `Mac-en svarte ikke (HTTP ${response.status})`);
  return result;
}

function base64ToBlob(dataUrl) {
  const [head, data] = String(dataUrl).split(",");
  const type = /^data:([^;]+);/.exec(head)?.[1] ?? "image/png";
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type });
}

// Nettleseren nekter å skrive når siden ikke har fokus, eller når trykket ikke
// regnes som ferskt nok. Begge kommer ut som en engelsk DOMException, og den
// sier ingenting om hva Ole skal gjøre. Den ene tingen som hjelper er å trykke
// på panelet og prøve igjen, så det er det raden skal si.
function forklarSkrivefeil(error) {
  const melding = String(error?.message ?? "");
  if (error?.name === "NotAllowedError" || /not focused|user gesture|denied/i.test(melding)) {
    return new Error("Nettleseren ga ikke panelet lov akkurat nå. Trykk én gang på panelet, og prøv igjen.");
  }
  return error instanceof Error ? error : new Error(melding || "Fikk ikke lagt det på utklippstavla");
}

// Kalles rett fra trykket. Innholdet er allerede hentet, så det står ingen
// `await` mellom trykket og skrivingen — det er nettopp det Safari krever.
export function writePhoneClipboard(snapshot, { clipboard = navigator.clipboard, ClipboardItemImpl = globalThis.ClipboardItem } = {}) {
  if (snapshot?.kind === "text") {
    if (!clipboard?.writeText) return Promise.reject(new Error("Nettleseren lar ikke panelet skrive til utklippstavla"));
    return clipboard.writeText(snapshot.text).catch((error) => { throw forklarSkrivefeil(error); });
  }
  if (snapshot?.kind === "image") {
    if (!clipboard?.write || !ClipboardItemImpl) {
      return Promise.reject(new Error("Denne nettleseren kan bare ta imot tekst fra Mac-en"));
    }
    const blob = base64ToBlob(snapshot.dataUrl);
    return clipboard.write([new ClipboardItemImpl({ [blob.type]: blob })]).catch((error) => { throw forklarSkrivefeil(error); });
  }
  return Promise.reject(new Error("Mac-ens utklippstavle er tom"));
}

// Hva raden skal si om det som ligger klart på Mac-en.
export function describeMacClipboard(snapshot) {
  if (!snapshot) return "Henter …";
  if (snapshot.kind === "image") return "Et bilde ligger klart";
  if (snapshot.kind === "text") {
    const linje = snapshot.text.split("\n").find((value) => value.trim()) ?? "";
    const kort = linje.length > 48 ? `${linje.slice(0, 48)}…` : linje;
    return kort || "Tekst ligger klar";
  }
  return "Ingenting på Mac-ens utklippstavle";
}
