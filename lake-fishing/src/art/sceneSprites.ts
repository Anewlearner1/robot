import { type SpriteMap } from "./sprite";

/** Seated fisher (14x18, faces right). Outline is added at build time. */
export const FISHER_MAP: SpriteMap = {
  rows: [
    "....hhhhhh....",
    "...hhhhhhhh...",
    ".hhHHHHHHHHhh.",
    "..rrsssssss...",
    "..rrssssksss..",
    "..rrsssssss...",
    "...rrsssss....",
    "....ccccs.....",
    "...cccccccc...",
    "...ccccccccgg.",
    "...cCccccccgg.",
    "...cCcccccc...",
    "...ppppppppp..",
    "...pPPPPPPPP..",
    "..........pp..",
    "..........pp..",
    ".........bbb..",
    ".........bbb.."
  ],
  palette: {
    h: "#e8c35a",
    H: "#c4553d",
    r: "#5a3a28",
    s: "#f0c8a2",
    k: "#2a2230",
    c: "#4a9a94",
    C: "#357874",
    g: "#f0c8a2",
    p: "#4f5f94",
    P: "#3c4878",
    b: "#5a4030"
  }
};

export const FISHER_OUTLINE = "#2a2230";

/** Cloud shapes. 'w' body, 'h' highlight, 's' shadow. */
export const CLOUD_MAPS: SpriteMap[] = [
  {
    rows: [
      "..........hhhh..........",
      "......hhhhwwwwwhh.......",
      "....hhwwwwwwwwwwwhhh....",
      "..hhwwwwwwwwwwwwwwwwhh..",
      ".hwwwwwwwwwwwwwwwwwwwwh.",
      "wwwwwwwwwwwwwwwwwwwwwwww",
      ".ssssssssssssssssssssss.",
      "...ssssssssssssssssss..."
    ],
    palette: { w: "", h: "", s: "" }
  },
  {
    rows: [
      "......hhh.........",
      "....hhwwwhh.......",
      "..hhwwwwwwwhhh....",
      ".hwwwwwwwwwwwwwh..",
      "wwwwwwwwwwwwwwwww.",
      ".sssssssssssssss..",
      "..ssssssssssss...."
    ],
    palette: { w: "", h: "", s: "" }
  },
  {
    rows: [
      "...hhhh......",
      ".hhwwwwhhh...",
      "hwwwwwwwwwwh.",
      "wwwwwwwwwwwww",
      ".sssssssssss."
    ],
    palette: { w: "", h: "", s: "" }
  }
];

/** Small bird, two wing frames. */
export const BIRD_FRAMES: string[][] = [
  ["o...o", ".o.o.", "..o.."],
  ["..o..", ".ooo.", "o...o"]
];

/** "!" speech bubble shown on bite (7x11). */
export const BUBBLE_MAP: SpriteMap = {
  rows: [
    ".wwwww.",
    "wwwrwww",
    "wwwrwww",
    "wwwrwww",
    "wwwrwww",
    "wwwwwww",
    "wwwrwww",
    ".wwwww.",
    "..www..",
    "...w..."
  ],
  palette: { w: "#fffdf4", r: "#e2453c" }
};

