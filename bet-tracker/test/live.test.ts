import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { espnDates, parseScoreboard, type EspnGame } from "../src/lib/scoreboard";
import { matchGame, pickedSide, teamScore } from "../src/lib/match";
import { cover } from "../src/lib/cover";
import { parsePick } from "../src/lib/pick";
import { zonedToIso } from "../src/lib/format";
import { findLegGame, linkBet, runPoll } from "../src/lib/live";
import { fakeAdmin, type Tables } from "./fake-db";

const NCAAB = "basketball/mens-college-basketball";
const NFL = "football/nfl";
const fixture = (name: string, league: string) =>
  parseScoreboard(JSON.parse(readFileSync(new URL(`./fixtures/espn-${name}.json`, import.meta.url), "utf8")), league);
const nov26 = fixture("ncaab26", NCAAB);
const nov27 = fixture("ncaab27", NCAAB);
const nfl29 = fixture("nfl", NFL);

const FIXTURES: Record<string, EspnGame[]> = {
  [`${NCAAB}|2026-11-26`]: nov26,
  [`${NCAAB}|2026-11-27`]: nov27,
  [`${NFL}|2026-11-29`]: nfl29,
};
function fixtureFetcher(log: string[] = []) {
  return async (league: string, ymd: string) => {
    log.push(`${league}|${ymd}`);
    return { ok: true as const, games: structuredClone(FIXTURES[`${league}|${ymd}`] ?? []) };
  };
}
const asTeams = (games: EspnGame[]) => games.map((g) => ({ id: g.id, away: g.away, home: g.home }));
const leg = (pick: string, market: string, away: string | null, home: string | null) => ({
  pick, market, away, home, ...parsePick(pick, market),
});

// ── adapter ──────────────────────────────────────────────────────────────

test("parses the real ESPN scoreboard shape", () => {
  const g = nov26.find((x) => x.id === "401920540")!;
  assert.equal(g.state, "post");
  assert.equal(g.detail, "Final");
  assert.equal(g.home.display, "Gonzaga Bulldogs");
  assert.equal(g.home.score, 72);
  assert.equal(g.away.short, "Baylor");
  assert.equal(g.away.score, 64);
  assert.match(g.url!, /^https:\/\/www\.espn\.com\/mens-college-basketball\/game\/_\/gameId\/401920540/);
  const pre = nov27.find((x) => x.id === "401920429")!;
  assert.equal(pre.state, "pre");
  assert.equal(pre.away.score, null, "pre-game scores are null, not 0");
});

test("parser fails soft on junk", () => {
  assert.deepEqual(parseScoreboard(null, NCAAB), []);
  assert.deepEqual(parseScoreboard({ events: [{ id: "1" }, "x", { competitions: [] }] }, NCAAB), []);
});

test("ESPN dates: Eastern day first, then Pacific", () => {
  assert.deepEqual(espnDates("2026-11-27T04:30:00Z", "2026-11-26"), ["2026-11-26"]);
  assert.deepEqual(espnDates("2026-11-28T05:30:00Z", "2026-11-27"), ["2026-11-28", "2026-11-27"]);
  assert.deepEqual(espnDates(null, "2026-11-27"), ["2026-11-27", "2026-11-28"]);
});

test("Pacific wall clock to instant", () => {
  assert.equal(zonedToIso("2026-11-27", "14:00"), "2026-11-27T22:00:00.000Z");
  assert.equal(zonedToIso("2026-07-04", "14:00"), "2026-07-04T21:00:00.000Z");
});

// ── matching ─────────────────────────────────────────────────────────────

test("Gonzaga @ Baylor, school names only, links even though ESPN has Gonzaga at home", () => {
  assert.equal(matchGame("Gonzaga", "Baylor", asTeams(nov26))?.id, "401920540");
});

test("links the Nov 27 slate legs that exist on ESPN", () => {
  const t = asTeams(nov27);
  assert.equal(matchGame("Virginia", "Xavier", t)?.id, "401920429");
  assert.equal(matchGame("Memphis", "Wake Forest", t)?.id, "401929288");
  assert.equal(matchGame("Georgetown", "UCLA", t)?.id, "401921717");
  assert.equal(matchGame("Texas", "Saint Mary's CA", t)?.id, "401921718");
  assert.equal(matchGame("Villanova", "Kansas", t)?.id, "401909789");
});

test("does not guess when a team isn't in any game", () => {
  const t = asTeams(nov27);
  // ESPN has Mississippi St vs Penn State and Texas A&M vs Marquette that day.
  assert.equal(matchGame("Mississippi State", "Mississippi", t), null);
  assert.equal(matchGame("Texas", "Texas A&M", t), null);
  assert.equal(matchGame("Florida", "Florida State", t), null);
});

test("name scoring prefers the closer team", () => {
  const tex = { display: "Texas Longhorns", short: "Texas", location: "Texas", abbr: "TEX" };
  const tam = { display: "Texas A&M Aggies", short: "Texas A&M", location: "Texas A&M", abbr: "TA&M" };
  assert.ok(teamScore("Texas", tex) > teamScore("Texas", tam));
  assert.ok(teamScore("Texas A&M", tam) > teamScore("Texas A&M", tex));
  assert.equal(teamScore("Mississippi State", { display: "Mississippi State Bulldogs", short: "Mississippi St", location: "Mississippi State" }), 1);
  assert.equal(teamScore("Mississippi St", { display: "Mississippi State Bulldogs", location: "Mississippi State" }), 1);
});

// ── cover line ───────────────────────────────────────────────────────────

const stored = (g: EspnGame) => ({
  away: g.away.display, home: g.home.display, away_short: g.away.short, home_short: g.home.short,
  away_abbr: g.away.abbr, home_abbr: g.home.abbr, away_score: g.away.score, home_score: g.home.score, state: g.state,
});

test("Gonzaga -3.5 covered by 4.5 (final 72-64, Gonzaga at home on ESPN)", () => {
  const g = stored(nov26.find((x) => x.id === "401920540")!);
  const c = cover(leg("Gonzaga -3.5", "Spread", "Gonzaga", "Baylor"), g)!;
  assert.equal(c.margin, 4.5);
  assert.equal(c.text, "Gonzaga -3.5: covered by 4.5");
  assert.equal(c.tone, "pos");
});

test("live spread, total and moneyline lines", () => {
  const live = { away: "Gonzaga Bulldogs", home: "Baylor Bears", away_score: 61, home_score: 47, state: "in" as const };
  assert.equal(cover(leg("Gonzaga -3.5", "Spread", "Gonzaga", "Baylor"), live)!.text, "Gonzaga -3.5: covering by 10.5");
  assert.equal(cover(leg("Baylor +3.5", "Spread", "Gonzaga", "Baylor"), live)!.text, "Baylor +3.5: needs 10.5");
  assert.equal(cover(leg("Over 104", "Total", "Gonzaga", "Baylor"), live)!.text, "Over 104: covering by 4");
  assert.equal(cover(leg("Over 120", "Total", "Gonzaga", "Baylor"), live)!.text, "Over 120: needs 12");
  assert.equal(cover(leg("Under 100", "Total", "Gonzaga", "Baylor"), live)!.text, "Under 100: over by 8");
  assert.equal(cover(leg("Baylor", "Moneyline", "Gonzaga", "Baylor"), live)!.text, "Baylor: trailing by 14");
  assert.equal(cover(leg("Gonzaga -14", "Spread", "Gonzaga", "Baylor"), live)!.text, "Gonzaga -14: push");
  assert.equal(cover(leg("Gonzaga -3.5", "Spread", "Gonzaga", "Baylor"), { ...live, state: "pre" }), null);
  assert.equal(cover(leg("Drew Timme 20+ pts", "Prop", "Gonzaga", "Baylor"), live), null);
});

test("picked side uses the leg's own matchup to break a name tie", () => {
  const g = { away: "Texas Longhorns", home: "Texas A&M Aggies", away_short: "Texas", home_short: "Texas A&M" };
  assert.equal(pickedSide({ team: "Texas A&M", away: "Texas", home: "Texas A&M" }, g), "home");
  assert.equal(pickedSide({ team: "Texas", away: "Texas", home: "Texas A&M" }, g), "away");
});

// ── poller ───────────────────────────────────────────────────────────────

function seed(): Tables {
  const bet = (id: string, date: string, extra: Record<string, unknown> = {}) => ({
    id, user_id: "u1", date, sport: "NCAAB", status: "open", is_future: false, type: "single", ...extra,
  });
  return {
    bets: [
      bet("b-gonz", "2026-11-26"),
      bet("b-uva", "2026-11-27"),
      bet("b-miss", "2026-11-27"),
      bet("b-sea", "2027-01-31", { sport: "NFL", is_future: true }),
      bet("b-old", "2026-11-01", { status: "won" }),
    ],
    legs: [
      { id: "l-gonz", bet_id: "b-gonz", team: "Gonzaga", away: "Gonzaga", home: "Baylor", start_at: "2026-11-27T04:30:00Z", game_id: "2026-11-26-gonz-bay", result: null },
      { id: "l-uva", bet_id: "b-uva", team: "Virginia", away: "Virginia", home: "Xavier", start_at: "2026-11-27T16:00:00Z", game_id: null, result: null },
      { id: "l-miss", bet_id: "b-miss", team: "Mississippi", away: "Mississippi State", home: "Mississippi", start_at: "2026-11-27T17:00:00Z", game_id: null, result: null },
      { id: "l-old", bet_id: "b-old", team: "Duke", away: "Duke", home: "UNC", start_at: "2026-11-01T20:00:00Z", game_id: null, result: "won" },
    ],
    futures_info: [{ bet_id: "b-sea", team: "Seattle Seahawks", next_game_id: null, next_start: "2026-11-29T21:25:00Z" }],
    games: [{ id: "2026-11-26-gonz-bay", league: NCAAB, state: "in", away: "Gonzaga Bulldogs", home: "Baylor Bears", away_score: 61, home_score: 47 }],
    poller_state: [{ id: 1, last_run: null, last_success: null, hot: false, tracked: 0 }],
  };
}

test("first tick links legs (Gonzaga off its placeholder), skips the unmatchable one, drops the placeholder", async () => {
  const db = seed();
  const { client } = fakeAdmin(db);
  const r = await runPoll(client, { now: new Date("2026-11-27T07:00:00Z"), fetcher: fixtureFetcher() });
  assert.equal(r.ran, true);
  const legOf = (id: string) => db.legs.find((l) => l.id === id)!;
  assert.equal(legOf("l-gonz").game_id, "401920540");
  assert.equal(legOf("l-uva").game_id, "401920429");
  assert.equal(legOf("l-miss").game_id, null, "Mississippi State @ Mississippi isn't on ESPN that day");
  assert.equal(legOf("l-old").game_id, null, "settled legs are left alone");
  assert.ok(!db.games.some((g) => g.id === "2026-11-26-gonz-bay"), "placeholder game removed");
  const gonz = db.games.find((g) => g.id === "401920540")!;
  assert.equal(gonz.state, "post");
  assert.equal(gonz.home_score, 72);
  assert.equal(r.hot, false, "next tip is 9 hours away");
  assert.ok(db.poller_state[0].last_success);
  assert.equal(db.futures_info[0].next_game_id, null, "Seahawks game is outside the 30 h window");
});

test("idle cadence: no ESPN call within 15 minutes when nothing is live or close", async () => {
  const db = seed();
  const { client } = fakeAdmin(db);
  await runPoll(client, { now: new Date("2026-11-27T07:00:00Z"), fetcher: fixtureFetcher() });
  const log: string[] = [];
  const r = await runPoll(client, { now: new Date("2026-11-27T07:05:00Z"), fetcher: fixtureFetcher(log) });
  assert.equal(r.ran, false);
  assert.match(r.reason, /idle/);
  assert.equal(log.length, 0);
  const r2 = await runPoll(client, { now: new Date("2026-11-27T07:16:00Z"), fetcher: fixtureFetcher(log) });
  assert.equal(r2.ran, true);
});

test("hot cadence: runs every tick from 15 minutes before tip", async () => {
  const db = seed();
  const { client } = fakeAdmin(db);
  await runPoll(client, { now: new Date("2026-11-27T15:40:00Z"), fetcher: fixtureFetcher() });
  const log: string[] = [];
  const r = await runPoll(client, { now: new Date("2026-11-27T15:46:00Z"), fetcher: fixtureFetcher(log) });
  assert.equal(r.ran, true);
  assert.equal(r.hot, true);
  assert.ok(log.length > 0);
});

test("nothing to follow: no ESPN calls at all", async () => {
  const db = seed();
  const { client } = fakeAdmin(db);
  const log: string[] = [];
  const r = await runPoll(client, { now: new Date("2026-12-20T07:00:00Z"), fetcher: fixtureFetcher(log) });
  assert.equal(r.ran, false);
  assert.equal(r.reason, "no games to follow");
  assert.equal(log.length, 0);
});

test("a game going final is reported, and only changed games are written", async () => {
  const db = seed();
  db.legs[0].game_id = "401920540";
  db.games = [{ id: "401920540", league: NCAAB, state: "in", start_at: "2026-11-27T04:53:00.000Z", away: "Baylor Bears", home: "Gonzaga Bulldogs", away_score: 60, home_score: 66, detail: "2nd 1:10", espn_url: null, away_short: "Baylor" }];
  const { client, writes } = fakeAdmin(db);
  const r = await runPoll(client, { now: new Date("2026-11-27T07:00:00Z"), fetcher: fixtureFetcher() });
  assert.deepEqual(r.final, ["401920540"]);
  assert.ok(writes.includes("games:upsert:401920540"));
  const before = writes.filter((w) => w.startsWith("games:upsert")).length;
  await runPoll(client, { now: new Date("2026-11-27T07:30:00Z"), fetcher: fixtureFetcher() });
  const after = writes.filter((w) => w.startsWith("games:upsert:401920540")).length;
  assert.equal(after, 1, "unchanged final game is not rewritten");
  assert.ok(before >= 1);
});

test("futures team links to its next game inside the window", async () => {
  const db = seed();
  const { client } = fakeAdmin(db);
  await runPoll(client, { now: new Date("2026-11-29T12:00:00Z"), fetcher: fixtureFetcher() });
  const g = db.games.find((x) => x.id === db.futures_info[0].next_game_id);
  assert.ok(g, "Seahawks next game linked");
  assert.ok(/Seahawks/.test(`${g!.away} ${g!.home}`));
});

test("ESPN down: keeps the last scores and records the error", async () => {
  const db = seed();
  db.legs[0].game_id = "401920540";
  db.games = [{ id: "401920540", league: NCAAB, state: "in", start_at: "2026-11-27T04:53:00.000Z", away_score: 60, home_score: 66 }];
  db.poller_state[0].last_success = "2026-11-27T06:59:00.000Z";
  const { client } = fakeAdmin(db);
  const down = async () => ({ ok: false as const, error: "ESPN: HTTP 503" });
  const r = await runPoll(client, { now: new Date("2026-11-27T07:00:00Z"), fetcher: down });
  assert.ok(r.errors.length);
  assert.equal(db.games[0].home_score, 66);
  assert.equal(db.poller_state[0].last_success, "2026-11-27T06:59:00.000Z");
  assert.match(String(db.poller_state[0].last_error), /503/);
});

test("save-time linking for a new bet", async () => {
  const db = seed();
  const { client } = fakeAdmin(db);
  // linkBet uses the live fetcher; point findLegGame at fixtures directly instead.
  const game = findLegGame({ team: "Kansas", away: "Villanova", home: "Kansas", start_at: "2026-11-27T22:00:00Z" }, nov27);
  assert.equal(game?.id, "401909789");
  assert.equal(await linkBet(client, "b-sea"), 0, "futures aren't linked at save time");
});
