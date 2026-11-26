import { call, message, nextPath, t } from "./auth.js";

const form = document.querySelector("#signin");
const submit = form.querySelector("button[type=submit]");
const toggle = document.querySelector("#toggle");
const next = nextPath("/account");
let signingUp = false;

toggle.addEventListener("click", () => {
  signingUp = !signingUp;
  form.classList.toggle("signing-up", signingUp);
  form.password.autocomplete = signingUp ? "new-password" : "current-password";
  submit.textContent = signingUp ? t.createAccount : t.signIn;
  toggle.textContent = signingUp ? t.toggleSignUp : t.toggleSignIn;
});

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = form.email.value.trim();
  const password = form.password.value;
  submit.disabled = true;
  try {
    if (signingUp) await call("/sign-up/email", { email, password, name: form.name.value.trim() || email.split("@")[0] });
    else await call("/sign-in/email", { email, password });
    location.assign(next);
  } catch (err) {
    message(err.message);
  } finally {
    submit.disabled = false;
  }
});

document.querySelector("#github")?.addEventListener("click", async () => {
  try {
    const { url } = await call("/sign-in/social", { provider: "github", callbackURL: next, errorCallbackURL: "/login" });
    location.assign(url);
  } catch (err) {
    message(err.message);
  }
});
