import { call, fmt, message, nextPath, t } from "./auth.js";

const form = document.querySelector("#signin");
const submit = form.querySelector("button[type=submit]");
const toggle = document.querySelector("#toggle");
const next = nextPath("/account");
// Email links come back here: signed in once confirmed, else with ?error= (an expired link, say).
const params = new URLSearchParams(location.search);
const callbackURL = `/login?${new URLSearchParams({ verified: "1", next })}`;
if (params.get("error")) message(Object.hasOwn(t.errors ?? {}, params.get("error")) ? t.errors[params.get("error")] : t.errors?.INVALID_TOKEN);
else if (params.get("verified") === "1") location.replace(next);
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
    if (signingUp) {
      // No session yet: the account works once the emailed link is opened.
      await call("/sign-up/email", { email, password, name: form.name.value.trim() || email.split("@")[0], callbackURL });
      form.password.value = "";
      message(fmt(t.checkInbox, { email }));
      return;
    }
    await call("/sign-in/email", { email, password, callbackURL });
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
