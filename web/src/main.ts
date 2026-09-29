import "./styles/main.css";
import "./styles/images.css";
import { initReveal } from "./lib/reveal";
import { renderAutumn } from "./sections/autumn";
import { renderCinnamon } from "./sections/cinnamon";
import { initFallingSprinkles, initParallax } from "./sections/hero";
import { renderInsta } from "./sections/insta";
import { renderMenu } from "./sections/menu";
import { initBurger } from "./sections/nav";
import { renderReviews } from "./sections/reviews";

// Order matches the legacy script (the seeded PRNG is consumed in sequence).
initFallingSprinkles();
renderMenu();
renderCinnamon();
renderReviews();
renderInsta();
renderAutumn();
initReveal();
initBurger();
initParallax();
