// Replaces the app's login password. Run it in your own terminal: npm run set-password
// It asks without showing what you type, and stores only a salted hash in src/ui/login.ts.
import { pbkdf2Sync, randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

const FILE = "src/ui/login.ts", ITERATIONS = 200000;

const input = process.stdin;
let unread = "";   // typed or pasted text beyond the end of the current line, kept for the next question
function ask(question) {
  process.stdout.write(question);
  return new Promise(resolve => {
    if (input.isTTY) input.setRawMode(true);
    input.setEncoding("utf8");
    let value = "";
    const take = () => {
      while (unread) {
        const ch = unread[0];
        unread = unread.slice(1);
        if (ch === "\u0003") { process.stdout.write("\n"); process.exit(1); }   // Ctrl+C
        if (ch === "\r" || ch === "\n") {
          if (ch === "\r" && unread[0] === "\n") unread = unread.slice(1);
          input.off("data", onData);
          input.off("end", onEnd);
          if (input.isTTY) input.setRawMode(false);
          input.pause();
          process.stdout.write("\n");
          resolve(value);
          return;
        }
        if (ch === "\u0008" || ch === "\u007f") value = value.slice(0, -1);
        else value += ch;
      }
    };
    const onData = text => { unread += text; take(); };
    const onEnd = () => { console.log("\nInput ended early. Nothing was changed."); process.exit(1); };
    input.on("data", onData);
    input.on("end", onEnd);
    input.resume();
    take();
  });
}

const first = await ask("New password (it won't show as you type): ");
if (first.length < 10) { console.log("Use at least 10 characters. Nothing was changed."); process.exit(1); }
const second = await ask("Same password again: ");
if (first !== second) { console.log("They didn't match. Nothing was changed."); process.exit(1); }

const salt = randomBytes(16).toString("hex");
const hash = pbkdf2Sync(first, Buffer.from(salt, "hex"), ITERATIONS, 32, "sha256").toString("hex");
const source = readFileSync(FILE, "utf8");
const line = /const INITIAL = \{ salt: "[0-9a-f]+", hash: "[0-9a-f]+" \};/;
if (!line.test(source)) { console.log(`Couldn't find the password line in ${FILE}. Nothing was changed.`); process.exit(1); }
writeFileSync(FILE, source.replace(line, `const INITIAL = { salt: "${salt}", hash: "${hash}" };`));
console.log("Done. The new password takes effect once the app is rebuilt and deployed.");
process.exit(0);
