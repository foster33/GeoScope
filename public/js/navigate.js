/**
 * Go to a saved spot: size the circle, drop it, and show the Explore tab —
 * exactly the state a globe click produces, so a re-analysis of a saved place
 * or a watch lands on the identical coordinates and radius.
 */
import { selectPoint, setRadiusMi } from "./globe.js";
import { showTab } from "./tabs.js";

export function goToPlace(lat, lon, radiusMi) {
  setRadiusMi(radiusMi);
  selectPoint(lat, lon);
  showTab("explore");
}
