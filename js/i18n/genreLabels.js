import { I18n } from "./index.js";

const GENRE_MESSAGE_KEYS = Object.freeze({
  action: "genre_action",
  adventure: "genre_adventure",
  animation: "genre_animation",
  comedy: "genre_comedy",
  crime: "genre_crime",
  documentary: "genre_documentary",
  drama: "genre_drama",
  family: "genre_family",
  fantasy: "genre_fantasy",
  history: "genre_history",
  horror: "genre_horror",
  music: "genre_music",
  mystery: "genre_mystery",
  romance: "genre_romance",
  "science fiction": "genre_science_fiction",
  "tv movie": "genre_tv_movie",
  thriller: "genre_thriller",
  war: "genre_war",
  western: "genre_western",
  anime: "genre_anime",
  biography: "genre_biography",
  children: "genre_children",
  donghua: "genre_donghua",
  "game show": "genre_game_show",
  holiday: "genre_holiday",
  "home and garden": "genre_home_and_garden",
  "mini series": "genre_mini_series",
  musical: "genre_musical",
  none: "genre_none",
  short: "genre_short",
  "special interest": "genre_special_interest",
  "sporting event": "genre_sporting_event",
  superhero: "genre_superhero",
  suspense: "genre_suspense",
  "talk show": "genre_talk",
  "action & adventure": "genre_action_adventure",
  kids: "genre_kids",
  news: "genre_news",
  reality: "genre_reality",
  "sci fi & fantasy": "genre_sci_fi_fantasy",
  soap: "genre_soap",
  talk: "genre_talk",
  "war & politics": "genre_war_politics"
});

function normalizeGenreKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replaceAll("-", " ")
    .replace(/\s+/g, " ");
}

export function localizedGenreLabel(genre) {
  const raw = String(genre || "").trim();
  if (!raw) {
    return "";
  }
  const messageKey = GENRE_MESSAGE_KEYS[normalizeGenreKey(raw)];
  return messageKey ? I18n.t(messageKey, {}, { fallback: raw }) : raw;
}

export function localizedGenreText(value, separator = " • ") {
  const values = Array.isArray(value) ? value : String(value || "").split(/[•,|/]/);
  return values.map(localizedGenreLabel).filter(Boolean).join(separator);
}
