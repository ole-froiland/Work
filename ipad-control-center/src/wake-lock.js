// Screen Wake Lock slippes automatisk når siden skjules. Kontrolleren holder
// derfor brukerens av/på-valg adskilt fra den faktiske nettleserlåsen, og ber
// om en ny lås når panelet blir synlig igjen.
// Nettleseren avviser låsen med en engelsk DOMException som ikke sier hva som
// må gjøres. De to grunnene som faktisk forekommer på en telefon i et feste er
// strømsparing og at panelet ikke står framme.
export function describeWakeLockRefusal(error) {
  const melding = String(error?.message ?? "");
  if (/power|battery/i.test(melding)) {
    return "Strømsparing hindrer at skjermen holdes våken. Slå den av, eller sett telefonen i lader.";
  }
  if (error?.name === "NotAllowedError") {
    return "Skjermen holdes våken først når panelet står framme på skjermen.";
  }
  return `Fikk ikke holdt skjermen våken (${melding || "ukjent grunn"})`;
}

export function createScreenWakeLockController({
  wakeLock,
  isVisible,
  onActiveChange = () => {},
  onError = () => {},
  schedule = (job, ms) => setTimeout(job, ms),
  retryMs = 1200,
}) {
  let wanted = false;
  let sentinel = null;
  let pending = null;

  function markActive(active) {
    onActiveChange(Boolean(active));
  }

  async function acquire() {
    if (!wanted || !isVisible()) return false;
    if (sentinel && !sentinel.released) {
      markActive(true);
      return true;
    }
    if (pending) return pending;
    if (typeof wakeLock?.request !== "function") return false;

    pending = (async () => {
      try {
        const lock = await wakeLock.request("screen");
        sentinel = lock;
        markActive(true);
        lock.addEventListener("release", () => {
          if (sentinel !== lock) return;
          sentinel = null;
          markActive(false);
          // Skjules panelet, tar `handleVisibilityChange` låsen igjen når det
          // kommer fram. Men iOS slipper den også mens panelet står framme —
          // typisk når strømsparing slår inn — og da kommer ingen hendelse
          // etterpå. Ett forsøk til, ikke flere: en lås som nektes om og om
          // igjen skal ikke bli en løkke som tømmer batteriet raskere.
          if (!wanted || !isVisible()) return;
          schedule(() => { if (wanted && isVisible()) acquire(); }, retryMs);
        }, { once: true });
        return true;
      } catch (error) {
        sentinel = null;
        markActive(false);
        onError(error);
        return false;
      } finally {
        pending = null;
      }
    })();
    return pending;
  }

  async function setWanted(next) {
    wanted = Boolean(next);
    if (wanted) return acquire();
    const lock = sentinel;
    sentinel = null;
    markActive(false);
    if (lock && !lock.released) await lock.release();
    return true;
  }

  async function handleVisibilityChange() {
    if (wanted && isVisible()) return acquire();
    return false;
  }

  async function destroy() {
    wanted = false;
    await setWanted(false);
  }

  return { acquire, destroy, handleVisibilityChange, setWanted };
}
