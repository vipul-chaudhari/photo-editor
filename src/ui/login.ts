/* Startup login. There is no server, so this all happens in the browser: it keeps casual visitors out, but
   someone who reads the page's code can get past it. Real protection needs a login on the hosting side.
   Only a salted hash of the password is stored here, never the password itself. */
import { $ } from "../state";
import { toast } from "./toast";

const USER = "admin";
const INITIAL = { salt: "3a76c39e89c8975bd9a373cddeb365f1", hash: "a8dc9c56ba5def82b5885565b8e13a3da2e1fa0b88a30e132787dae21a35ce52" };
const ITERATIONS = 200000;
const SESSION_KEY = "lightbox-session", PASSWORD_KEY = "lightbox-password";
const SESSION_MS = 8 * 60 * 60 * 1000;

const read = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const write = (k: string, v: string | null) => { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch {} };
const hex = (b: ArrayBuffer | Uint8Array) => Array.from(new Uint8Array(b as ArrayBuffer), x => x.toString(16).padStart(2, "0")).join("");
const bytes = (h: string) => Uint8Array.from(h.match(/../g) || [], x => parseInt(x, 16));

async function derive(password: string, salt: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  return hex(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: bytes(salt), iterations: ITERATIONS }, key, 256));
}
/* A password changed on this browser replaces the initial one, on this browser only. */
function current(): { salt: string; hash: string } {
  try { return JSON.parse(read(PASSWORD_KEY) || "") || INITIAL; } catch { return INITIAL; }
}
const passwordOk = async (password: string) => { const c = current(); return await derive(password, c.salt) === c.hash; };
const signedIn = () => +(read(SESSION_KEY) || 0) > Date.now();

function card(title: string, fields: string, submit: string, extra = "") {
  const screen = document.createElement("div");
  screen.className = "preload"; screen.id = "login";
  screen.setAttribute("role", "dialog"); screen.setAttribute("aria-modal", "true"); screen.setAttribute("aria-label", title);
  screen.innerHTML = `<form class="preload-card" autocomplete="on">
    <h2>${title}</h2>
    ${fields}
    <p class="login-error" id="loginError" role="alert"></p>
    <button id="loginSubmit" class="btn primary wide" type="submit">${submit}</button>
    ${extra}
  </form>`;
  document.body.append(screen);
  return screen;
}
const field = (id: string, label: string, type: string, auto: string) =>
  `<label class="login-field" for="${id}">${label}<input id="${id}" class="num" type="${type}" autocomplete="${auto}" required></label>`;

function askLogin(done: () => void) {
  const screen = card("Sign in to Lightbox", field("loginUser", "Username", "text", "username") + field("loginPass", "Password", "password", "current-password"), "Sign in");
  const form = screen.querySelector("form")!, error = screen.querySelector("#loginError")!;
  const input = (id: string) => screen.querySelector("#" + id) as HTMLInputElement;
  input("loginUser").focus();
  form.addEventListener("submit", async e => {
    e.preventDefault();
    error.textContent = "";
    if (!crypto.subtle) { error.textContent = "Signing in needs a secure connection (https or localhost)."; return; }
    const ok = input("loginUser").value.trim() === USER && await passwordOk(input("loginPass").value);
    if (!ok) { error.textContent = "That username or password isn't right."; input("loginPass").value = ""; input("loginPass").focus(); return; }
    write(SESSION_KEY, String(Date.now() + SESSION_MS));
    screen.remove();
    done();
  });
}

function askChange() {
  const screen = card("Change password",
    field("oldPass", "Current password", "password", "current-password") + field("newPass", "New password", "password", "new-password") + field("newPass2", "New password again", "password", "new-password"),
    "Change password", `<button id="changeCancel" class="btn wide" type="button">Cancel</button><p class="note">This changes it on this browser only.</p>`);
  const form = screen.querySelector("form")!, error = screen.querySelector("#loginError")!;
  const value = (id: string) => (screen.querySelector("#" + id) as HTMLInputElement).value;
  (screen.querySelector("#oldPass") as HTMLInputElement).focus();
  screen.querySelector("#changeCancel")!.addEventListener("click", () => screen.remove());
  form.addEventListener("submit", async e => {
    e.preventDefault();
    if (!await passwordOk(value("oldPass"))) { error.textContent = "The current password isn't right."; return; }
    if (value("newPass").length < 8) { error.textContent = "Use at least 8 characters."; return; }
    if (value("newPass") !== value("newPass2")) { error.textContent = "The new passwords don't match."; return; }
    const salt = hex(crypto.getRandomValues(new Uint8Array(16)));
    write(PASSWORD_KEY, JSON.stringify({ salt, hash: await derive(value("newPass"), salt) }));
    screen.remove();
    toast("Password changed on this browser.");
  });
}

/* Runs done() once someone is signed in. */
export function initLogin(done: () => void) {
  const anchor = $("meta");
  const link = (id: string, text: string, run: () => void) => {
    const b = document.createElement("button");
    b.id = id; b.className = "link-btn"; b.type = "button"; b.textContent = text;
    b.addEventListener("click", run);
    anchor.after(b);
  };
  link("signOut", "Sign out", () => { write(SESSION_KEY, null); location.reload(); });
  link("changePass", "Change password", askChange);
  if (signedIn()) done(); else askLogin(done);
}
