// Devices pages: filter the handheld table as you type, and copy the flash commands.
const input = document.querySelector("#device-q");
const table = document.querySelector(".hh-table");
if (input && table) {
  const rows = [...table.querySelectorAll("tbody tr[data-search]")];
  const none = table.querySelector("tr.none");
  input.addEventListener("input", () => {
    const q = input.value.trim().toLowerCase();
    let shown = 0;
    for (const r of rows) {
      const ok = !q || r.dataset.search.includes(q);
      r.hidden = !ok;
      if (ok) shown++;
    }
    if (none) none.hidden = shown > 0;
  });
}

for (const b of document.querySelectorAll("button.copy-btn")) {
  b.hidden = false;
  const label = b.textContent;
  b.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(b.dataset.copy);
      b.textContent = b.dataset.done;
      setTimeout(() => (b.textContent = label), 1600);
    } catch {
      // No clipboard access: the command is still there to select.
    }
  });
}
