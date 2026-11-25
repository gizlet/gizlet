import { call, message, signIn } from "./auth.js";

const form = document.querySelector("#device");
const session = await call("/get-session").catch(() => null);
if (!session) signIn(location.pathname + location.search);

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const action = e.submitter?.value === "deny" ? "deny" : "approve";
  const userCode = form.user_code.value.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
  try {
    // Opening the code claims it for this account; only then can it be approved.
    const status = await call(`/device?user_code=${encodeURIComponent(userCode)}`);
    if (status.status !== "pending") throw new Error(`This code was already ${status.status}.`);
    await call(`/device/${action}`, { userCode });
    form.hidden = true;
    message(action === "approve" ? "Your device is signed in. You can close this page." : "The request was denied.");
  } catch (err) {
    message(err.message);
  }
});
