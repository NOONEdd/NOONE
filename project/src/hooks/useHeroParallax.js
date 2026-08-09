import { useEffect } from "react";

export function useHeroParallax() {
  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const coarse = window.matchMedia("(pointer: coarse)").matches;
    if (reduced || coarse) return;
    let raf = null;
    function onMove(e) {
      const mx = e.clientX / window.innerWidth - 0.5;
      const my = e.clientY / window.innerHeight - 0.5;
      if (!raf) {
        raf = requestAnimationFrame(() => {
          document.querySelectorAll(".hero-orb").forEach((orb, i) => {
            const depth = (i + 1) * 9;
            orb.style.transform = `translate(${mx * depth}px, ${my * depth}px)`;
          });
          raf = null;
        });
      }
    }
    window.addEventListener("mousemove", onMove, { passive: true });
    return () => window.removeEventListener("mousemove", onMove);
  }, []);
}
