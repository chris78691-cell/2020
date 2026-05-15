/**
 * Tiny progress tracker. Hands out `track(promise)` and emits progress
 * to subscribers via `onProgress`. `waitAll()` resolves once every
 * tracked promise has settled.
 */
export function createLoader() {
  let total = 0;
  let done = 0;
  const subs = [];
  let resolveAll;
  const allPromise = new Promise((res) => {
    resolveAll = res;
  });
  let allStarted = false;

  function emit() {
    const pct = total === 0 ? 0 : done / total;
    for (const cb of subs) cb(pct, done, total);
  }

  function maybeResolveAll() {
    // Resolve when at least one promise has been tracked and all are done
    if (allStarted && done >= total) {
      resolveAll();
    }
  }

  return {
    track(promise) {
      total++;
      allStarted = true;
      emit();
      const wrap = (val) => {
        done++;
        emit();
        maybeResolveAll();
        return val;
      };
      return promise.then(wrap, (err) => {
        // Treat errors as "done" so the loader doesn't hang forever
        done++;
        emit();
        maybeResolveAll();
        throw err;
      });
    },
    onProgress(cb) {
      subs.push(cb);
      cb(total === 0 ? 0 : done / total, done, total);
    },
    waitAll() {
      return allPromise;
    },
    get done() { return done; },
    get total() { return total; },
  };
}
