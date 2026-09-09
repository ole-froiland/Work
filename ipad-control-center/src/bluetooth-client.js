// Nettleserens side av hodetelefonbytteren. Mac-siden ligger i
// `server/bluetooth-service.mjs`; her er bare henting og den ene veien panelet
// har til telefonen sin egen lyd.

export const SHORTCUT_PREFIX = "panel-bt-shortcut-";

export async function fetchHeadphones() {
  try {
    const response = await fetch("/api/bluetooth", { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } catch (error) {
    return {
      ok: false,
      powered: false,
      devices: [],
      error: `Åpne panelet på Mac-en for å styre Bluetooth (${error.message})`,
    };
  }
}

// Mac-en kan ikke be telefonen om å koble til noe — en Bluetooth-forbindelse
// startes av enheten som vil ha lyden. Det telefonen kan, er å kjøre en av sine
// egne snarveier, og «Angi avspillingsmål» gjør nettopp dette ene.
//
// Navnet legges i spørringen og ikke i stien: en snarvei kan hete «AirPods &
// meg», og et navn med skråstrek eller ampersand ville ellers delt adressen i to.
export function shortcutUrl(name) {
  const trimmed = String(name ?? "").trim();
  if (!trimmed) return null;
  return `shortcuts://run-shortcut?name=${encodeURIComponent(trimmed)}`;
}

export function readShortcutName(storage, id) {
  if (!id) return "";
  try {
    return storage?.getItem(`${SHORTCUT_PREFIX}${id}`) ?? "";
  } catch {
    return "";
  }
}

// Et tomt navn fjerner snarveien i stedet for å lagre tomheten. Ellers ville
// raden tilbudt en knapp som åpner Snarveier på ingenting.
export function saveShortcutName(storage, id, name) {
  if (!id) return "";
  const trimmed = String(name ?? "").trim();
  try {
    if (trimmed) storage?.setItem(`${SHORTCUT_PREFIX}${id}`, trimmed);
    else storage?.removeItem(`${SHORTCUT_PREFIX}${id}`);
  } catch {
    // Privat vindu: snarveien huskes da bare så lenge panelet står åpent.
  }
  return trimmed;
}
