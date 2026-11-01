/* Where this app serves its own model files. Worked out on the page and sent to workers in their load
   message, because a relative address inside a worker would point into the build's assets folder. */
export const MODEL_BASE = new URL("models/", document.baseURI).href;
