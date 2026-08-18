/* Exam clocks that survive a backgrounded tab.
 *
 * Every countdown in the app used to decrement a piece of state once per
 * setInterval/setTimeout tick. Mobile browsers throttle background timers hard
 * and stop them altogether when the screen locks, so a candidate who switched
 * apps mid-answer came back with an under-counted clock: the writing
 * simulator's 60 minutes ran long, and the speaking recorder's auto-stop fired
 * after the official 2:00 / 3:30 / 2:30 limit rather than on it.
 *
 * For a product whose selling point is reproducing the real exam's
 * constraints, the clock is the one thing that cannot drift. These hooks work
 * from a wall-clock deadline instead, so a throttled or suspended tab loses
 * resolution but never loses time.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

/* Ticking faster than once a second costs nothing and means the displayed
   value is never more than a quarter-second stale after a resume. */
const TICK_MS = 250;

/**
 * Seconds remaining until a deadline, recomputed from the wall clock.
 *
 * @param {boolean} running whether the clock should be advancing
 * @param {number}  totalSeconds full duration, used when the clock (re)starts
 * @param {object}  options
 * @param {number}  options.endsAt absolute epoch ms to count down to; when
 *                  given it wins over totalSeconds, so a deadline restored
 *                  from storage resumes exactly where it left off
 * @param {(remaining: number) => void} options.onTick called with each new
 *                  value, for threshold warnings
 * @param {() => void} options.onExpire called once, when the clock reaches 0
 * @returns {[number, () => void]} remaining seconds, and a reset function
 */
export function useCountdown(running, totalSeconds, { endsAt, onTick, onExpire } = {}) {
  const deadlineRef = useRef(null);
  const firedRef = useRef(false);
  const [remaining, setRemaining] = useState(
    () => (endsAt ? Math.max(0, Math.ceil((endsAt - Date.now()) / 1000)) : totalSeconds));

  // Held in refs so a caller can pass inline closures without restarting the
  // clock on every render.
  const onTickRef = useRef(onTick);
  const onExpireRef = useRef(onExpire);
  useEffect(() => { onTickRef.current = onTick; }, [onTick]);
  useEffect(() => { onExpireRef.current = onExpire; }, [onExpire]);

  const reset = useCallback((seconds = totalSeconds) => {
    deadlineRef.current = null;
    firedRef.current = false;
    setRemaining(seconds);
  }, [totalSeconds]);

  useEffect(() => {
    if (!running) { deadlineRef.current = null; return undefined; }

    if (deadlineRef.current == null) {
      deadlineRef.current = endsAt || Date.now() + remaining * 1000;
    }

    const read = () => {
      const left = Math.max(0, Math.ceil((deadlineRef.current - Date.now()) / 1000));
      setRemaining((prev) => (prev === left ? prev : left));
      onTickRef.current?.(left);
      if (left <= 0 && !firedRef.current) {
        firedRef.current = true;
        onExpireRef.current?.();
      }
    };

    read();
    const id = setInterval(read, TICK_MS);
    // Coming back to a suspended tab must correct the display immediately
    // rather than on the next tick.
    const onVisible = () => { if (!document.hidden) read(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
    // `remaining` is deliberately absent: it is the output of this effect, and
    // including it would restart the interval on every tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, endsAt]);

  return [remaining, reset];
}

/**
 * Seconds elapsed since the clock started — the recorder's counting-up twin.
 *
 * @param {boolean} running
 * @param {object} options
 * @param {number} options.limitSeconds stop and fire onLimit at this value
 * @param {() => void} options.onLimit
 */
export function useStopwatch(running, { limitSeconds, onLimit } = {}) {
  const startedRef = useRef(0);
  const firedRef = useRef(false);
  const [elapsed, setElapsed] = useState(0);
  const onLimitRef = useRef(onLimit);
  useEffect(() => { onLimitRef.current = onLimit; }, [onLimit]);

  const reset = useCallback(() => {
    startedRef.current = 0;
    firedRef.current = false;
    setElapsed(0);
  }, []);

  useEffect(() => {
    if (!running) { startedRef.current = 0; return undefined; }
    if (!startedRef.current) { startedRef.current = Date.now(); firedRef.current = false; }

    const read = () => {
      const secs = Math.floor((Date.now() - startedRef.current) / 1000);
      setElapsed((prev) => (prev === secs ? prev : secs));
      if (limitSeconds && secs >= limitSeconds && !firedRef.current) {
        firedRef.current = true;
        onLimitRef.current?.();
      }
    };

    read();
    const id = setInterval(read, TICK_MS);
    const onVisible = () => { if (!document.hidden) read(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [running, limitSeconds]);

  return [elapsed, reset];
}

/* mm:ss for a second count. */
export function clock(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}
