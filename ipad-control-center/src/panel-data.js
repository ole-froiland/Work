import { useCallback, useEffect, useRef, useState } from "react";

// Panelet henter det meste på samme måte: én GET med jevne mellomrom, en
// manuell oppdatering som kan gå til en annen adresse, og en feilbehandler som
// får si hva raden skal stå med. Hooken lå i App.jsx, men mobilvisningen henter
// de samme kildene — og to utgaver av pollingen er to steder å endre intervall.
export function usePolledResource(url, { interval, initial = null, parse, onError, refreshUrl = url }) {
  const [value, setValue] = useState(initial);
  const settings = useRef({ parse, onError });
  settings.current = { parse, onError };

  const load = useCallback(async (alive = () => true, target = url) => {
    const { parse: read, onError: fail } = settings.current;
    try {
      const response = await fetch(target, { cache: "no-store" });
      const snapshot = read ? await read(response) : await readJsonResponse(response);
      if (alive()) setValue(snapshot);
    } catch (error) {
      if (alive() && fail) setValue((current) => fail(current, error));
    }
  }, [url]);

  useEffect(() => {
    let active = true;
    const alive = () => active;
    load(alive);
    const timer = window.setInterval(() => load(alive), interval);
    return () => { active = false; window.clearInterval(timer); };
  }, [load, interval]);

  return [value, useCallback(() => load(undefined, refreshUrl), [load, refreshUrl]), setValue];
}

export async function readJsonResponse(response) {
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}
