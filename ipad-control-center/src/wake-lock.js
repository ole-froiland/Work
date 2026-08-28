// Screen Wake Lock slippes automatisk når siden skjules. Kontrolleren holder
// derfor brukerens av/på-valg adskilt fra den faktiske nettleserlåsen, og ber
// om en ny lås når panelet blir synlig igjen.
export function createScreenWakeLockController({ wakeLock, isVisible, onActiveChange = () => {}, onError = () => {} }) {
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
