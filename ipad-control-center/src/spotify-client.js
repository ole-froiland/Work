import { useEffect, useState } from "react";

// Spotify Connect-laget, uten noe utseende. iPad-kortet og mobilkortet ser helt
// ulike ut, men de gjør nøyaktig det samme mot Spotify: henter i et tempo som
// følger avspillingen, teller framdriften lokalt mellom hentingene, og lar
// aldri et lokalt anslag stå igjen som sannhet. To utgaver av den logikken ville
// før eller siden hatt hvert sitt tempo og hver sin framdrift.
export function useSpotify({ onToast }) {
  const [player, setPlayer] = useState(null);
  const [readAt, setReadAt] = useState(() => Date.now());
  const [clock, setClock] = useState(() => Date.now());
  const [devices, setDevices] = useState(null);
  const [busy, setBusy] = useState(false);

  const authorized = Boolean(player?.authorized);
  const playing = Boolean(player?.playing);
  const pollMs = !authorized ? 30_000 : playing ? 5_000 : 15_000;

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const response = await fetch("/api/spotify", { cache: "no-store" });
        const snapshot = await response.json();
        if (!active) return;
        setPlayer(snapshot);
        setReadAt(Date.now());
        setClock(Date.now());
      } catch (error) {
        if (active) setPlayer({ ok: false, configured: true, authorized: false, error: `Fikk ikke kontakt med panelet (${error.message})` });
      }
    }
    load();
    const interval = window.setInterval(load, pollMs);
    return () => { active = false; window.clearInterval(interval); };
  }, [pollMs]);

  // Sporet går videre mellom hentingene, så framdriften telles lokalt.
  useEffect(() => {
    if (!playing) return undefined;
    const timer = window.setInterval(() => setClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [playing]);

  async function send(command, payload = {}) {
    setBusy(true);
    try {
      const response = await fetch("/api/spotify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command, ...payload }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.ok) throw new Error(result.error || `HTTP ${response.status}`);
      return result;
    } catch (error) {
      onToast(error.message);
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function refresh() {
    try {
      const response = await fetch("/api/spotify", { cache: "no-store" });
      setPlayer(await response.json());
      setReadAt(Date.now());
      setClock(Date.now());
    } catch {
      // Neste automatiske henting rydder opp.
    }
  }

  // Spotify bruker et halvsekund på å bekrefte en kommando, så visningen
  // oppdateres lokalt først og hentes på nytt like etter.
  async function control(command, optimistic) {
    if (optimistic) setPlayer((current) => (current ? { ...current, ...optimistic } : current));
    const result = await send(command);
    window.setTimeout(refresh, result ? 600 : 0);
  }

  async function openDevices() {
    setBusy(true);
    try {
      const response = await fetch("/api/spotify?devices=1", { cache: "no-store" });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.ok) throw new Error(result.error || `HTTP ${response.status}`);
      setDevices(result.devices);
    } catch (error) {
      onToast(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function pickDevice(device) {
    setDevices(null);
    const result = await send("transfer", { deviceId: device.id });
    if (result) {
      onToast(`Spiller på ${device.name}`);
      window.setTimeout(refresh, 900);
    }
  }

  async function connect() {
    const result = await send("authorize");
    if (result) onToast("Fullfør Spotify-innloggingen i nettleseren på Mac-en");
  }

  const track = player?.track ?? null;
  const duration = track?.durationMs ?? 0;
  const elapsed = playing ? Math.max(0, clock - readAt) : 0;
  const progress = duration > 0 ? Math.min(duration, (player?.progressMs ?? 0) + elapsed) : 0;

  return {
    player,
    track,
    devices,
    busy,
    playing,
    authorized,
    duration,
    progress,
    progressPercent: duration > 0 ? (progress / duration) * 100 : 0,
    closeDevices: () => setDevices(null),
    control,
    openDevices,
    pickDevice,
    connect,
  };
}
