import { useEffect, useRef, useState } from 'react';

import { progressAt, speak, type NavProgress, type NavRoute } from './navigation';

/**
 * Drives a simulated vehicle along a route (sped up so a trip plays in 9–30 s) and speaks the
 * route's voice prompts as they come due, like the Navigation SDK's simulated location provider.
 */
export function useRouteSim(route: NavRoute | null, opts: { voice: boolean; onArrive: () => void }): NavProgress | null {
  const [progress, setProgress] = useState<NavProgress | null>(null);
  const onArrive = useRef(opts.onArrive);
  const voice = useRef(opts.voice);
  onArrive.current = opts.onArrive;
  voice.current = opts.voice;

  useEffect(() => {
    if (!route) {
      setProgress(null);
      return;
    }
    const playMs = Math.min(30000, Math.max(9000, (route.duration * 1000) / 25));
    const t0 = performance.now();
    let next = 0;
    let raf = 0;
    const tick = (now: number) => {
      const p = progressAt(route, route.length * Math.min(1, (now - t0) / playMs));
      let due: string | null = null;
      while (next < route.prompts.length && route.prompts[next].at <= p.traveled) due = route.prompts[next++].text;
      if (due && voice.current) speak(due);
      setProgress(p);
      if (p.arrived) onArrive.current();
      else raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [route]);

  return progress;
}
