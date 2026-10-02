import { stripThinking } from "./ollama.ts";


// ==========================================
// WHAT TO SEND AS A REPLY STREAMS IN
// ==========================================
//
// The model sends its reply in small pieces, and
// think tags have to come out before anything is
// shown. Cleaning each piece on its own trimmed
// it - so a piece that was " the" lost its space,
// and words ran together on screen until the reply
// finished and was replaced whole.
//
// So the whole reply so far is cleaned, and only
// what is new since the last send goes out. If the
// visible text stops starting with what was sent -
// a think tag opened after text was on screen - the
// view starts again from what is visible now.
//

export function nextStreamed(sent: string, contentSoFar: string) {
  const visible = stripThinking(contentSoFar);

  if (visible.startsWith(sent)) {
    return {
      reset: false,
      text: visible.slice(sent.length),
      sent: visible,
    };
  }

  return { reset: true, text: visible, sent: visible };
}
