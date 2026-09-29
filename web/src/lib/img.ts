import images from "../data/images.json";
import type { ImageInfo } from "../data/types";

const IMG: Record<string, ImageInfo> = images;

/** src/width/height/loading attributes for an image key (replaces legacy data-donut). */
export function imgAttrs(key: string): string {
  const i = IMG[key];
  if (!i) return "";
  return `src="${i.src}" width="${i.w}" height="${i.h}" loading="lazy"`;
}
