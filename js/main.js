(() => {
  const root = document.documentElement;

  // Mobile drawer
  const toggle = document.querySelector(".menu-toggle");
  const menu = document.getElementById("mobile-menu");
  const setMenu = open => {
    toggle.setAttribute("aria-expanded", String(open));
    toggle.querySelector(".menu-toggle-label").textContent = open ? "Close" : "Menu";
    menu.hidden = !open;
  };
  toggle.addEventListener("click", () => setMenu(menu.hidden));
  menu.addEventListener("click", event => { if (event.target.closest("a")) setMenu(false); });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && !menu.hidden) { setMenu(false); toggle.focus(); }
  });
  matchMedia("(min-width: 961px)").addEventListener("change", event => { if (event.matches) setMenu(false); });

  // Highlight the section currently in view
  const navLinks = [...document.querySelectorAll(".desktop-nav a")];
  if ("IntersectionObserver" in window) {
    const observer = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        navLinks.forEach(link => {
          if (link.hash === "#" + entry.target.id) link.setAttribute("aria-current", "true");
          else link.removeAttribute("aria-current");
        });
      });
    }, { rootMargin: "-45% 0px -50% 0px" });
    navLinks.forEach(link => { const target = document.querySelector(link.hash); if (target) observer.observe(target); });
  }

  // Only one video plays at a time
  document.addEventListener("play", event => {
    document.querySelectorAll("video").forEach(video => { if (video !== event.target) video.pause(); });
  }, true);

  // Gallery filter
  const items = [...document.querySelectorAll(".gallery-item")];
  const filters = [...document.querySelectorAll(".filter")];
  const status = document.getElementById("gallery-status");
  filters.forEach(button => button.addEventListener("click", () => {
    const group = button.dataset.filter;
    filters.forEach(b => b.setAttribute("aria-pressed", String(b === button)));
    let shown = 0;
    items.forEach(item => {
      const visible = group === "all" || item.dataset.group === group;
      item.hidden = !visible;
      item.classList.toggle("is-entering", visible);
      if (visible) shown += 1;
    });
    status.textContent = `Showing ${shown} ${group === "all" ? "items" : button.textContent.toLowerCase() + " items"}.`;
  }));

  // Lightbox
  const dialog = document.getElementById("lightbox");
  if (!dialog || typeof dialog.showModal !== "function") return;
  const stage = dialog.querySelector(".lightbox-media");
  const caption = dialog.querySelector(".lightbox-caption");
  const count = dialog.querySelector(".lightbox-count");
  let current = 0;
  let opener = null;

  const visibleButtons = () => items.filter(item => !item.hidden).map(item => item.querySelector(".gallery-button"));

  const render = () => {
    const list = visibleButtons();
    const button = list[current];
    const data = button.dataset;
    stage.replaceChildren();
    if (data.video) {
      const video = document.createElement("video");
      video.controls = true;
      video.playsInline = true;
      video.preload = "metadata";
      video.poster = data.poster;
      video.src = data.video;
      video.setAttribute("aria-label", data.caption);
      stage.append(video);
    } else {
      const picture = document.createElement("picture");
      const source = document.createElement("source");
      source.type = "image/webp";
      source.srcset = data.fullWebp;
      const img = document.createElement("img");
      img.src = data.fullJpg;
      img.alt = data.alt;
      img.width = Number(data.width);
      img.height = Number(data.height);
      picture.append(source, img);
      stage.append(picture);
    }
    caption.textContent = data.caption;
    count.textContent = `${current + 1} / ${list.length}`;
  };

  const step = delta => {
    const length = visibleButtons().length;
    current = (current + delta + length) % length;
    render();
  };

  const close = () => { if (dialog.open) dialog.close(); };

  items.forEach(item => item.querySelector(".gallery-button").addEventListener("click", event => {
    opener = event.currentTarget;
    current = visibleButtons().indexOf(opener);
    render();
    root.classList.add("lightbox-open");
    dialog.showModal();
    dialog.querySelector(".lightbox-close").focus();
  }));

  dialog.querySelector(".lightbox-close").addEventListener("click", close);
  dialog.querySelectorAll(".lightbox-nav").forEach(button => button.addEventListener("click", () => step(Number(button.dataset.step))));
  dialog.addEventListener("click", event => { if (event.target === dialog || event.target === stage) close(); });
  dialog.addEventListener("keydown", event => {
    if (event.key === "ArrowRight") { event.preventDefault(); step(1); }
    else if (event.key === "ArrowLeft") { event.preventDefault(); step(-1); }
  });
  dialog.addEventListener("close", () => {
    stage.replaceChildren();
    root.classList.remove("lightbox-open");
    if (opener) opener.focus();
  });

  let touchX = null;
  stage.addEventListener("touchstart", event => { touchX = event.touches[0].clientX; }, { passive: true });
  stage.addEventListener("touchend", event => {
    if (touchX === null) return;
    const dx = event.changedTouches[0].clientX - touchX;
    if (Math.abs(dx) > 50 && !stage.querySelector("video")) step(dx < 0 ? 1 : -1);
    touchX = null;
  });
})();
