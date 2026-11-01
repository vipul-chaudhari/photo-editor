/* Wires the editor together and opens with the generated sample photo.
   Init order matches the top-to-bottom order of the original single-file script. */
import "./styles.css";
import "./theme.css";
import { markPreset, initAdjustments } from "./ui/adjustments";
import { initAutoAdjust } from "./ui/autoAdjust";
import { initCompare } from "./ui/compare";
import { initExportSheet } from "./ui/exportSheet";
import { initImageIO, setImage } from "./io/loadImage";
import { samplePhoto } from "./io/samplePhoto";
import { initSelect } from "./features/select/select";
import { initBackground } from "./features/background/background";
import { initEraser } from "./features/eraser/eraser";
import { initHistory } from "./history";
import { initPreload } from "./ui/preload";
import { initLogin } from "./ui/login";
import { initMobile } from "./ui/mobile";
import { initCredits } from "./ui/credits";
import { initTransform } from "./features/transform/transform";
import { initEnhance } from "./features/enhance/enhance";

initHistory();
initAdjustments();
initAutoAdjust();
initCompare();
initImageIO();
initExportSheet();
initSelect();
initBackground();
initEraser();
initTransform();
initEnhance();
initCredits();
initMobile();

const s = samplePhoto();
setImage(s, s.width, s.height, "sample", true, false);
markPreset();
initLogin(initPreload);
