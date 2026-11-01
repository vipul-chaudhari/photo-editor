/* Only one big model in graphics memory at a time: Smart select's model is let go while another AI tool runs. */
import { state } from "../state";
import { ai, clearHover } from "./select/select";

export function releaseSam() {
  if (!ai.worker || state.selecting) return;
  ai.worker.terminate(); ai.worker = null; ai.state = "off";
  ai.encodedId = ai.encodingId = -1; clearHover();
}
