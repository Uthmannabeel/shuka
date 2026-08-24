// Shared site behaviour: mobile nav + reveal-on-scroll.
{
const toggle = document.querySelector(".nav-toggle");
const nav = document.querySelector(".topnav");
if (toggle && nav) {
  toggle.addEventListener("click", () => {
    const open = nav.classList.toggle("open");
    toggle.setAttribute("aria-expanded", String(open));
  });
}

const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const revealed = document.querySelectorAll(".reveal");
if (reduced || !("IntersectionObserver" in window)) {
  revealed.forEach((el) => el.classList.add("in"));
} else {
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); }
      }
    },
    { threshold: 0.12 }
  );
  revealed.forEach((el) => io.observe(el));
}

// Light/dark toggle. System preference is the default; an explicit choice
// is stored and applied before first paint by the inline <head> script.
const themeBtn = document.querySelector(".theme-btn");
if (themeBtn) {
  themeBtn.addEventListener("click", () => {
    const root = document.documentElement;
    const systemDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const current = root.dataset.theme || (systemDark ? "dark" : "light");
    const next = current === "dark" ? "light" : "dark";
    root.dataset.theme = next;
    try { localStorage.setItem("shuka-theme", next); } catch {}
  });
}
}
