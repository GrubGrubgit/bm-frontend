// P4: entrance-save detector (pure logic, no DOM/engine).
// Up held while standing stably on a door side prompts a save.
// overlap must hold STABLE_NEED consecutive frames (filters the $49/$4B
// post-handler flicker); prompt fires once per side until the player
// leaves (key change re-arms). Holding Up while walking in also prompts.
export const UP_MASK = 0x10;
export const STABLE_NEED = 6;
export function createDetector(stableNeed) {
  return { need: (stableNeed | 0) > 0 ? (stableNeed | 0) : STABLE_NEED, run: 0, lastKey: null };
}
export function detectorKey(area, x, y) { return area + ':' + x + ',' + y; }
export function stepDetector(det, overlap, area, x, y, up) {
  if (!overlap) { det.run = 0; det.lastKey = null; return { stable: false, prompt: false }; }
  const key = detectorKey(area, x, y);
  det.run++;
  const stable = det.run >= det.need;
  const prompt = stable && !!up && det.lastKey !== key;
  if (prompt) det.lastKey = key;
  return { stable, prompt };
}
export function resetDetector(det) { det.run = 0; det.lastKey = null; }

