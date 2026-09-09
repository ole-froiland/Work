// Nettleserens side av hodetelefonbytteren. Mac-siden ligger i
// `server/bluetooth-service.mjs`.

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
