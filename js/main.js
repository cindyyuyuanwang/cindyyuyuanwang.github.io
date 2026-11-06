document.querySelectorAll(".mobile-nav-links a").forEach((link) => {
  link.addEventListener("click", () => {
    const menu = link.closest(".mobile-nav");
    if (!menu) {
      return;
    }

    menu.open = false;
  });
});
