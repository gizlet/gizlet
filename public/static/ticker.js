const track = document.querySelector(".ticker .run");

if (track) {
  const ticker = track.parentElement;
  const cycle = track.firstElementChild;
  const resize = new ResizeObserver(() => {
    const step = cycle.getBoundingClientRect().width;
    if (!step) return;
    const copies = Math.ceil(ticker.getBoundingClientRect().width / step) + 1;
    while (track.childElementCount < copies) track.append(cycle.cloneNode(true));
    while (track.childElementCount > copies) track.lastElementChild.remove();
    track.style.setProperty("--ticker-step", `${-step}px`);
  });
  resize.observe(ticker);
  resize.observe(cycle);

  let onScreen = false;
  const updatePlayback = () => track.classList.toggle("scrolling", onScreen && !document.hidden);
  new IntersectionObserver(([entry]) => {
    onScreen = entry.isIntersecting;
    updatePlayback();
  }).observe(ticker);
  document.addEventListener("visibilitychange", updatePlayback);
}
