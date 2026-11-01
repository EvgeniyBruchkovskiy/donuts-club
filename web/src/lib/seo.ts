import autumn from "../data/autumn.json";
import cinnamon from "../data/cinnamon.json";
import menu from "../data/menu.json";
import type { AutumnTab, Cinnamon, MenuItem } from "../data/types";

const SITE = "https://donutsclub.kr.ua/";

interface MenuItemLd {
  "@type": "MenuItem";
  name: string;
  description?: string;
  offers?: { "@type": "Offer"; price: string; priceCurrency: "UAH" };
}

const priceOf = (p: string): string | undefined => {
  const m = /\d+(?:[.,]\d+)?/.exec(p);
  return m ? m[0].replace(",", ".") : undefined;
};

const item = (name: string, price: string, description?: string): MenuItemLd => {
  const out: MenuItemLd = { "@type": "MenuItem", name };
  if (description) out.description = description;
  const p = priceOf(price);
  if (p) out.offers = { "@type": "Offer", price: p, priceCurrency: "UAH" };
  return out;
};

const stripEmoji = (s: string): string => s.replace(/[\p{Extended_Pictographic}️]/gu, "").trim();

/**
 * Menu structured data built from the same JSON the grids render from, so it never
 * goes stale. Search engines execute JS, so injecting it at runtime is fine.
 */
export function injectMenuJsonLd(): void {
  const cin = cinnamon as Cinnamon;
  const sections = [
    { name: "Пончики (донати)", items: (menu as MenuItem[]).map((m) => item(m.n, m.price, m.d)) },
    {
      name: "Сінамони",
      items: [...cin.sweet, ...cin.salty].map((c) => item(c.n, c.price)),
    },
    ...(autumn as AutumnTab[]).map((t) => ({
      name: stripEmoji(t.tab),
      items: t.items.map((a) => item(a.n, a.price, a.d)),
    })),
  ];
  const ld = {
    "@context": "https://schema.org",
    "@type": "Menu",
    "@id": SITE + "#menu",
    name: "Меню DONUTS CLUB",
    inLanguage: "uk-UA",
    hasMenuSection: sections.map((s) => ({ "@type": "MenuSection", name: s.name, hasMenuItem: s.items })),
  };
  const script = document.createElement("script");
  script.type = "application/ld+json";
  script.textContent = JSON.stringify(ld);
  document.head.appendChild(script);
}
