export interface ImageInfo { src: string; w: number; h: number }
export interface MenuItem { n: string; d: string; img: string; price: string; tag?: string }
export interface CinnamonItem { n: string; img: string; price: string; tag?: string }
export interface Cinnamon { sweet: CinnamonItem[]; salty: CinnamonItem[] }
export interface AutumnItem { n: string; d: string; img?: string; price: string; tag?: string }
export interface AutumnTab { tab: string; items: AutumnItem[] }
export interface Review { t: string; n: string; r: string; c: string }
