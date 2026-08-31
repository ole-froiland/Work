// Hver knapp som gjør noe på Mac-en går denne veien. Kallet lå tre steder i
// App.jsx med hver sin kopi av feilhåndteringen; mobilvisningen ville blitt den
// fjerde. Feilen kastes videre med Mac-ens egen tekst — den sier hvorfor, og
// den forskjellen er hele grunnen til at knappen finnes.
export async function callMacAction(body, { fetchImpl = globalThis.fetch } = {}) {
  const response = await fetchImpl("/api/mac-action", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.ok) throw new Error(result.error || `HTTP ${response.status}`);
  return result;
}
