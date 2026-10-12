import {
  ATTENTION_STRENGTH,
  ATTENTION_TIMING,
  AttentionTracker,
  attentionApplies,
  attentionOverrideVersion,
  clampStrength,
  getAttentionGain,
  resetAttention,
  setAttentionGain,
  setAttentionOverride,
  shouldDuck,
  stepGain,
  streamVolume,
  subscribeAttentionGain,
  subscribeAttentionOverrides,
  targetGain,
} from "../../src/lib/audio-attention";

let f = 0, p = 0;
const ok = (n: string, c: boolean, d?: unknown) => { c ? p++ : (f++, console.log("FAIL", n, JSON.stringify(d))); };
const eq = (n: string, got: unknown, want: unknown) => ok(n, JSON.stringify(got) === JSON.stringify(want), { got, want });
const near = (n: string, got: number, want: number, tol = 0.01) => ok(n, Math.abs(got - want) <= tol, { got, want });

// ---- When to duck ---------------------------------------------------------------------------------------------------------
eq("watching and someone talks: duck", shouldDuck({ watching: true, othersSpeaking: 1 }), true);
eq("several talking: still one duck", shouldDuck({ watching: true, othersSpeaking: 4 }), true);
eq("watching, silence: leave it", shouldDuck({ watching: true, othersSpeaking: 0 }), false);
eq("not watching anything: never", shouldDuck({ watching: false, othersSpeaking: 3 }), false);

// ---- How far ----------------------------------------------------------------------------------------------------------------
near("default strength takes 60% off", targetGain(true, ATTENTION_STRENGTH.default), 0.4);
eq("not ducked is untouched", targetGain(false, 0.9), 1);
near("90% is the most", targetGain(true, 1), 1 - ATTENTION_STRENGTH.max);
near("it can never silence the stream: 20% is the least duck, 90% the most", targetGain(true, 0), 1 - ATTENTION_STRENGTH.min);
ok("it can never go to zero", targetGain(true, 5) > 0);
eq("a junk strength becomes the default", [clampStrength("x"), clampStrength(NaN), clampStrength(undefined)], [0.6, 0.6, 0.6]);

// ---- The fade -------------------------------------------------------------------------------------------------------------------
{
  // Going down is fast, going up is slow.
  const down = stepGain(1, 0.4, ATTENTION_TIMING.attack);
  const up = stepGain(0.4, 1, ATTENTION_TIMING.attack);
  ok("down closes about two thirds of the gap in one attack time", down > 0.55 && down < 0.65, down);
  ok("and is within a hair of the target after three", stepGain(1, 0.4, ATTENTION_TIMING.attack * 3) < 0.45);
  ok("up covers much less in the same time", 1 - up > 1 - down && up < 0.8, { up, down });
  ok("it never overshoots", [0, 16, 100, 1000, 60000].every((dt) => stepGain(1, 0.4, dt) >= 0.4 && stepGain(0.4, 1, dt) <= 1));
  eq("no time passing changes nothing", stepGain(0.7, 0.4, 0), 0.7);
  eq("a negative step is no step", stepGain(0.7, 0.4, -50), 0.7);
  eq("arrived stays arrived", stepGain(0.4, 0.4, 100), 0.4);
  // Many small steps get where one big one does, which is what makes it independent of the frame rate.
  const run = (dt: number) => { let g = 1; for (let t = 0; t < 300; t += dt) g = stepGain(g, 0.4, dt); return g; };
  near("60 fps and 30 fps end in the same place", run(16.7), run(33.3), 0.02);
  let g = 1, steps = 0;
  while (g !== 0.4 && steps < 1000) { g = stepGain(g, 0.4, 16); steps++; }
  ok("a fade ends exactly on its target, and soon", g === 0.4 && steps < 100, steps);
  steps = 0; g = 0.4;
  while (g !== 1 && steps < 2000) { g = stepGain(g, 1, 16); steps++; }
  ok("release ends exactly at full volume", g === 1 && steps < 300, steps);
  ok("release takes noticeably longer than attack", (() => { let a = 1, n1 = 0; while (a !== 0.4) { a = stepGain(a, 0.4, 16); n1++; } let b = 0.4, n2 = 0; while (b !== 1) { b = stepGain(b, 1, 16); n2++; } return n2 > n1 * 2; })());
}

// ---- Holding through pauses -------------------------------------------------------------------------------------------------------
{
  const t = new AttentionTracker();
  eq("quiet room: not ducked", t.update(0, { watching: true, othersSpeaking: 0 }), false);
  eq("someone starts: ducked", t.update(100, { watching: true, othersSpeaking: 1 }), true);
  eq("a breath later it holds", t.update(100 + ATTENTION_TIMING.hold - 50, { watching: true, othersSpeaking: 0 }), true);
  eq("then lets go", t.update(100 + ATTENTION_TIMING.hold + 50, { watching: true, othersSpeaking: 0 }), false);
  t.update(5000, { watching: true, othersSpeaking: 1 });
  eq("stops watching: lets go at once", t.update(5100, { watching: false, othersSpeaking: 1 }), false);
  eq("and doesn't remember the old speech when it resumes", t.update(5200, { watching: true, othersSpeaking: 0 }), false);
  const u = new AttentionTracker();
  u.update(0, { watching: true, othersSpeaking: 1 });
  u.update(600, { watching: true, othersSpeaking: 1 });
  eq("talking again restarts the hold", u.update(600 + ATTENTION_TIMING.hold - 10, { watching: true, othersSpeaking: 0 }), true);
}

// ---- The shared level and who it reaches -----------------------------------------------------------------------------------
{
  resetAttention();
  eq("starts at full", getAttentionGain(), 1);
  let seen = 0;
  const off = subscribeAttentionGain(() => seen++);
  setAttentionGain(0.4);
  setAttentionGain(0.4);
  eq("a change is announced once, a repeat isn't", seen, 1);
  setAttentionGain(-3);
  eq("the level can't go below 0", getAttentionGain(), 0);
  setAttentionGain(9);
  eq("or above 1", getAttentionGain(), 1);
  off();
  setAttentionGain(0.5);
  eq("an unsubscribed listener is left alone", seen, 3);

  // The stream's own volume, ducked or not.
  setAttentionGain(0.4);
  near("a ducked stream is the person's level times the duck", streamVolume(0.8, false, "a", true), 0.32);
  eq("a stream that isn't subject to it keeps its level", streamVolume(0.8, false, "a", false), 0.8);
  eq("muted is silent, whatever else", streamVolume(0.8, true, "a", true), 0);
  ok("it never raises a stream above the person's own level", streamVolume(0.5, false, "a", true) <= 0.5);
  eq("a level above 1 is held to 1", streamVolume(7, false, "a", false), 1);
  eq("a negative level is held to 0", streamVolume(-1, false, "a", false), 0);

  // Right-click choices override the setting, per stream.
  eq("no choice: the setting decides", [attentionApplies("a", true), attentionApplies("a", false)], [true, false]);
  let changes = 0;
  const offChoice = subscribeAttentionOverrides(() => changes++);
  const v = attentionOverrideVersion();
  setAttentionOverride("a", false);
  eq("turning it off for one stream beats the setting being on", attentionApplies("a", true), false);
  eq("and doesn't touch another stream", attentionApplies("b", true), true);
  eq("turning it on for one stream beats the setting being off", (setAttentionOverride("b", true), attentionApplies("b", false)), true);
  eq("a stream turned off plays at its own level even while ducked", streamVolume(0.8, false, "a", true), 0.8);
  ok("each choice is announced, and bumps the version", changes === 2 && attentionOverrideVersion() > v);
  setAttentionOverride("a", undefined);
  eq("clearing a choice goes back to the setting", attentionApplies("a", true), true);
  offChoice();

  // A finished call leaves nothing behind.
  setAttentionOverride("b", true);
  setAttentionGain(0.4);
  resetAttention();
  eq("after a call: full level", getAttentionGain(), 1);
  eq("after a call: no leftover choices", [attentionApplies("a", false), attentionApplies("b", false)], [false, false]);
}

console.log(f ? `${f} FAILED (${p} passed)` : `ALL PASSED (${p})`);
process.exit(f ? 1 : 0);
