(() => {
  const root = document.documentElement;

  // Mobile drawer
  const drawer = document.querySelector(".mobile-drawer");
  if (drawer) {
    drawer.addEventListener("click", event => { if (event.target.closest("a")) drawer.open = false; });
    document.addEventListener("keydown", event => {
      if (event.key === "Escape" && drawer.open) {
        drawer.open = false;
        drawer.querySelector("summary").focus();
      }
    });
  }

  // Highlight the section currently in view (none while in the hero)
  const navLinks = [...document.querySelectorAll('.desktop-nav a[href^="#"]')];
  const setCurrent = id => navLinks.forEach(link => {
    if (link.hash === "#" + id) link.setAttribute("aria-current", "true");
    else link.removeAttribute("aria-current");
  });
  if ("IntersectionObserver" in window) {
    const observer = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        setCurrent(entry.target.id === "top" ? null : entry.target.id);
      });
    }, { rootMargin: "-45% 0px -50% 0px" });
    const hero = document.getElementById("top");
    if (hero) observer.observe(hero);
    navLinks.forEach(link => { const target = document.getElementById(link.hash.slice(1)); if (target) observer.observe(target); });
  }

  // Only one video plays at a time
  document.addEventListener("play", event => {
    document.querySelectorAll("video").forEach(video => { if (video !== event.target) video.pause(); });
  }, true);

  document.querySelectorAll(".gallery-choice").forEach(choice => choice.addEventListener("change", () => {
    document.querySelectorAll(".gallery-film video").forEach(video => {
      if (!video.getClientRects().length) video.pause();
    });
  }));

  document.querySelectorAll(".film-frame").forEach(frame => {
    const video = frame.querySelector("video");
    const start = frame.querySelector(".film-start");
    start.hidden = false;
    start.addEventListener("click", () => {
      video.focus();
      video.play().catch(() => { start.hidden = true; });
    });
    video.addEventListener("play", () => { start.hidden = true; });
    video.addEventListener("ended", () => { start.hidden = false; });
  });

  // Lightbox
  const dialog = document.getElementById("lightbox");
  if (!dialog || typeof dialog.showModal !== "function") return;
  const stage = dialog.querySelector(".lightbox-media");
  const caption = dialog.querySelector(".lightbox-caption");
  const count = dialog.querySelector(".lightbox-count");
  let current = 0;
  let opener = null;

  const links = [...document.querySelectorAll(".gallery-grid a")];
  const visibleLinks = () => links.filter(link => link.getClientRects().length);

  const render = (playVideo = false) => {
    const list = visibleLinks();
    const link = list[current];
    const data = link.dataset;
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
      if (playVideo) video.play().catch(() => { /* Native controls remain available. */ });
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
    const length = visibleLinks().length;
    current = (current + delta + length) % length;
    render();
  };

  const close = () => { if (dialog.open) dialog.close(); };

  links.forEach(link => link.addEventListener("click", event => {
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    opener = event.currentTarget;
    current = visibleLinks().indexOf(opener);
    dialog.showModal();
    root.classList.add("lightbox-open");
    render(true);
    dialog.querySelector(".lightbox-close").focus();
  }));

  dialog.querySelector(".lightbox-close").addEventListener("click", close);
  dialog.querySelectorAll(".lightbox-nav").forEach(button => button.addEventListener("click", () => step(Number(button.dataset.step))));
  dialog.addEventListener("click", event => { if (event.target === dialog || event.target === stage) close(); });
  dialog.addEventListener("keydown", event => {
    if (event.target.tagName === "VIDEO") return;
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
