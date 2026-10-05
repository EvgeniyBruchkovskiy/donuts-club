import { RATING_WORDS } from "./copy";

/** Five radio buttons drawn as stars (keyboard: arrows inside the group, like any radio set). */
export function initStars(host: HTMLElement, word: HTMLElement, name: string, onChange: (v: number) => void): void {
  host.setAttribute("role", "radiogroup");
  for (let v = 1; v <= 5; v++) {
    const id = `${name}-${v}`;
    const input = document.createElement("input");
    input.type = "radio";
    input.name = name;
    input.value = String(v);
    input.id = id;
    input.className = "fb-star-input";
    const label = document.createElement("label");
    label.htmlFor = id;
    label.className = "fb-star";
    label.title = RATING_WORDS[v];
    label.innerHTML = `<span class="sr-only">${RATING_WORDS[v]}</span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.6l2.9 5.9 6.5.9-4.7 4.6 1.1 6.5L12 17.4l-5.8 3.1 1.1-6.5L2.6 9.4l6.5-.9z"/></svg>`;
    input.addEventListener("change", () => {
      host.dataset.value = String(v);
      word.textContent = RATING_WORDS[v];
      onChange(v);
    });
    host.append(input, label);
  }
}
