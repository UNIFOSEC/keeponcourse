const SVG_NS = "http://www.w3.org/2000/svg";

type Shape = [tag: "path" | "circle" | "rect", attrs: Record<string, string | number>];
const p = (d: string): Shape => ["path", { d }];
const circle = (cx: number, cy: number, r: number): Shape => ["circle", { cx, cy, r }];
const rect = (x: number, y: number, width: number, height: number, rx = 0): Shape => [
  "rect",
  { x, y, width, height, rx },
];

// 24×24 stroke icons, built with createElementNS (no SVG markup strings)
const ICONS = {
  dashboard: [rect(3, 3, 7, 9, 1.5), rect(14, 3, 7, 5, 1.5), rect(14, 12, 7, 9, 1.5), rect(3, 16, 7, 5, 1.5)],
  book: [p("M2 4h6a4 4 0 0 1 4 4v13a3 3 0 0 0-3-3H2z"), p("M22 4h-6a4 4 0 0 0-4 4v13a3 3 0 0 1 3-3h7z")],
  sparkles: [p("M11 3l1.9 5.1L18 10l-5.1 1.9L11 17l-1.9-5.1L4 10l5.1-1.9z"), p("M19 14v4"), p("M21 16h-4")],
  info: [circle(12, 12, 10), p("M12 16v-4"), p("M12 8h.01")],
  plus: [p("M12 5v14"), p("M5 12h14")],
  search: [circle(11, 11, 7), p("m20 20-3.5-3.5")],
  board: [rect(3, 3, 18, 18, 2), p("M9 3v18"), p("M15 3v18")],
  list: [p("M8 6h13"), p("M8 12h13"), p("M8 18h13"), p("M3 6h.01"), p("M3 12h.01"), p("M3 18h.01")],
  x: [p("M18 6 6 18"), p("m6 6 12 12")],
  trash: [
    p("M3 6h18"),
    p("M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"),
    p("M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"),
  ],
  pencil: [p("M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z")],
  calendar: [rect(3, 4, 18, 18, 2), p("M16 2v4"), p("M8 2v4"), p("M3 10h18")],
  sun: [
    circle(12, 12, 4),
    p("M12 2v2"),
    p("M12 20v2"),
    p("m4.93 4.93 1.41 1.41"),
    p("m17.66 17.66 1.41 1.41"),
    p("M2 12h2"),
    p("M20 12h2"),
    p("m6.34 17.66-1.41 1.41"),
    p("m19.07 4.93-1.41 1.41"),
  ],
  moon: [p("M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z")],
  monitor: [rect(2, 3, 20, 14, 2), p("M8 21h8"), p("M12 17v4")],
  database: [
    p("M3 5c0 1.66 4 3 9 3s9-1.34 9-3-4-3-9-3-9 1.34-9 3"),
    p("M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"),
    p("M3 12c0 1.66 4 3 9 3s9-1.34 9-3"),
  ],
  server: [rect(2, 3, 20, 8, 2), rect(2, 13, 20, 8, 2), p("M6 7h.01"), p("M6 17h.01")],
  alert: [circle(12, 12, 10), p("M12 8v4"), p("M12 16h.01")],
  check: [p("M20 6 9 17l-5-5")],
  checkCircle: [circle(12, 12, 10), p("m8 12 3 3 5-6")],
  clock: [circle(12, 12, 10), p("M12 6v6l4 2")],
  shield: [p("M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"), p("m9 12 2 2 4-4")],
  refresh: [p("M3 12a9 9 0 0 1 15-6.7L21 8"), p("M21 3v5h-5"), p("M21 12a9 9 0 0 1-15 6.7L3 16"), p("M3 21v-5h5")],
  arrowRight: [p("M5 12h14"), p("m12 5 7 7-7 7")],
  play: [circle(12, 12, 10), p("m10 8 6 4-6 4z")],
  code: [p("m16 18 6-6-6-6"), p("m8 6-6 6 6 6")],
  flag: [p("M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"), p("M4 22v-7")],
  arrowUp: [p("m5 12 7-7 7 7"), p("M12 19V5")],
  user: [circle(12, 8, 4), p("M4 21a8 8 0 0 1 16 0")],
  logOut: [p("M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"), p("m16 17 5-5-5-5"), p("M21 12H9")],
  download: [p("M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"), p("m7 10 5 5 5-5"), p("M12 15V3")],
  cloud: [p("M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z")],
  mail: [rect(2, 4, 20, 16, 2), p("m22 7-10 6L2 7")],
  stop: [rect(6, 6, 12, 12, 2)],
  undo: [p("M3 7v6h6"), p("M21 17a9 9 0 0 0-15-6.7L3 13")],
  compose: [p("M12 20h9"), p("M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z")],
} satisfies Record<string, Shape[]>;

export type IconName = keyof typeof ICONS;

export function svgEl<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number> = {},
): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attrs)) el.setAttribute(name, String(value));
  return el;
}

export function icon(name: IconName, size = 18): SVGSVGElement {
  const svg = svgEl("svg", {
    viewBox: "0 0 24 24",
    width: size,
    height: size,
    fill: "none",
    stroke: "currentColor",
    "stroke-width": 2,
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
    "aria-hidden": "true",
    focusable: "false",
    class: "icon",
  });
  for (const [tag, attrs] of ICONS[name]) svg.appendChild(svgEl(tag, attrs));
  return svg;
}

let logoCount = 0;

/** The KeepOnCourse mark: a compass on a violet gradient tile. */
export function logo(size = 30): SVGSVGElement {
  const id = `cch-logo-${++logoCount}`;
  const svg = svgEl("svg", { viewBox: "0 0 32 32", width: size, height: size, "aria-hidden": "true", class: "logo" });
  const defs = svgEl("defs");
  const gradient = svgEl("linearGradient", { id, x1: 0, y1: 0, x2: 1, y2: 1 });
  gradient.append(svgEl("stop", { offset: 0, "stop-color": "#8b5cf6" }), svgEl("stop", { offset: 1, "stop-color": "#6366f1" }));
  defs.appendChild(gradient);
  svg.append(
    defs,
    svgEl("rect", { width: 32, height: 32, rx: 8, fill: `url(#${id})` }),
    svgEl("circle", { cx: 16, cy: 16, r: 9.5, fill: "none", stroke: "#fff", "stroke-width": 2.2 }),
    // Compass needle pointing north-east: "on course"
    svgEl("path", { d: "M20.6 11.4 18.2 18.2 11.4 20.6 13.8 13.8Z", fill: "#fff" }),
    svgEl("circle", { cx: 16, cy: 16, r: 1.4, fill: `url(#${id})` }),
  );
  return svg;
}
