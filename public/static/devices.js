// Devices and gizlet pages: filter the handheld table as you type, copy commands, and show screenshots full size.
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

// Gizlet pages: a screenshot opens full size; clicking outside the image or Esc closes it.
const shots = document.querySelector(".gz-shots");
if (shots && typeof HTMLDialogElement === "function") {
  const box = document.createElement("dialog");
  box.className = "lightbox";
  box.setAttribute("aria-label", shots.previousElementSibling?.textContent ?? "");
  const img = document.createElement("img");
  img.alt = "";
  box.append(img);
  document.body.append(box);
  shots.addEventListener("click", (e) => {
    const a = e.target.closest("a");
    if (!a || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    img.src = a.href;
    box.showModal();
  });
  box.addEventListener("click", (e) => {
    if (e.target !== img) box.close();
  });
  box.addEventListener("close", () => img.removeAttribute("src"));
}
