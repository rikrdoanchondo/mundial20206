/**
 * Vercel Serverless Function — /api/match?id=<fixtureId>
 * ------------------------------------------------------
 * Detalle de UN partido bajo demanda: alineaciones, eventos (goles/tarjetas)
 * y estadísticas (tiros, córners, posesión, fueras de lugar, faltas, etc.).
 * Se pide solo cuando el usuario abre la tarjeta de un partido, así no se
 * gasta cuota del plan gratuito en partidos que nadie mira.
 *
 * Caché en la CDN: partidos terminados se cachean mucho (cambian poco);
 * partidos en vivo, poco. El navegador nunca ve la API key.
 */

export default async function handler(req, res) {
  const KEY = process.env.APISPORTS_KEY;
  const HOST = process.env.APISPORTS_HOST || "v3.football.api-sports.io";
  const id = String((req.query && req.query.id) || "").replace(/[^0-9]/g, "");

  res.setHeader("content-type", "application/json; charset=utf-8");

  if (!id) {
    res.setHeader("cache-control", "public, max-age=30");
    return res.status(200).send(JSON.stringify({ ok: false, error: "missing_id" }));
  }
  if (!KEY) {
    res.setHeader("cache-control", "public, max-age=30");
    return res.status(200).send(JSON.stringify({ ok: false, error: "missing_key" }));
  }

  const headers = {};
  if (process.env.APISPORTS_RAPIDAPI === "1") {
    headers["x-rapidapi-key"] = KEY;
    headers["x-rapidapi-host"] = HOST;
  } else {
    headers["x-apisports-key"] = KEY;
  }

  try {
    const base = `https://${HOST}`;
    const [evRes, lnRes, stRes] = await Promise.all([
      fetch(`${base}/fixtures/events?fixture=${id}`, { headers }).catch(() => null),
      fetch(`${base}/fixtures/lineups?fixture=${id}`, { headers }).catch(() => null),
      fetch(`${base}/fixtures/statistics?fixture=${id}`, { headers }).catch(() => null),
    ]);

    const evJson = evRes ? await safeJson(evRes) : {};
    const lnJson = lnRes ? await safeJson(lnRes) : {};
    const stJson = stRes ? await safeJson(stRes) : {};

    const events = extractEvents(evJson);
    const lineups = extractLineups(lnJson);
    const stats = extractStats(stJson);

    const payload = { ok: true, id, ts: Date.now(), events, lineups, stats };

    // El cliente indica si el partido está EN VIVO (?live=1). Si lo está, cachea muy poco
    // para que goles/tarjetas se actualicen casi al instante; si no, cachea fuerte (el
    // detalle de un partido terminado no cambia). NO se infiere "terminado" por la mera
    // existencia de eventos: un partido en vivo con gol también tiene eventos.
    const isLive = String((req.query && req.query.live) || "") === "1";
    res.setHeader("cache-control", isLive
      ? "public, max-age=0, s-maxage=20, stale-while-revalidate=40"
      : "public, max-age=0, s-maxage=900, stale-while-revalidate=3600");
    return res.status(200).send(JSON.stringify(payload));
  } catch (e) {
    res.setHeader("cache-control", "public, max-age=30");
    return res.status(200).send(JSON.stringify({ ok: false, error: "upstream_error", detail: String(e) }));
  }
}

/* ---------- helpers ---------- */

function extractEvents(j) {
  const arr = j?.response;
  if (!Array.isArray(arr)) return [];
  return arr.map(e => ({
    minute: e?.time?.elapsed ?? null,
    extra: e?.time?.extra ?? null,
    teamId: e?.team?.id ?? null,
    team: e?.team?.name ?? null,
    player: e?.player?.name ?? null,
    assist: e?.assist?.name ?? null,
    type: e?.type ?? null,        // Goal | Card | subst | Var
    detail: e?.detail ?? null,    // Normal Goal | Own Goal | Penalty | Yellow Card | Red Card...
  }));
}

function extractLineups(j) {
  const arr = j?.response;
  if (!Array.isArray(arr)) return [];
  return arr.map(t => ({
    teamId: t?.team?.id ?? null,
    team: t?.team?.name ?? null,
    formation: t?.formation ?? null,
    coach: t?.coach?.name ?? null,
    startXI: (Array.isArray(t?.startXI) ? t.startXI : []).map(p => ({
      name: p?.player?.name ?? null,
      number: p?.player?.number ?? null,
      pos: p?.player?.pos ?? null,
    })),
    subs: (Array.isArray(t?.substitutes) ? t.substitutes : []).map(p => ({
      name: p?.player?.name ?? null,
      number: p?.player?.number ?? null,
      pos: p?.player?.pos ?? null,
    })),
  }));
}

function extractStats(j) {
  const arr = j?.response;
  if (!Array.isArray(arr)) return [];
  return arr.map(t => {
    const map = {};
    for (const s of (Array.isArray(t?.statistics) ? t.statistics : [])) {
      map[String(s?.type || "").trim()] = s?.value;
    }
    return {
      teamId: t?.team?.id ?? null,
      team: t?.team?.name ?? null,
      // claves normalizadas y tolerantes a nulos
      possession: map["Ball Possession"] ?? null,
      shots: map["Total Shots"] ?? null,
      shotsOn: map["Shots on Goal"] ?? null,
      shotsOff: map["Shots off Goal"] ?? null,
      corners: map["Corner Kicks"] ?? null,
      offsides: map["Offsides"] ?? null,
      fouls: map["Fouls"] ?? null,
      yellow: map["Yellow Cards"] ?? null,
      red: map["Red Cards"] ?? null,
      saves: map["Goalkeeper Saves"] ?? null,
      passes: map["Total passes"] ?? null,
      passAccuracy: map["Passes %"] ?? null,
      xg: map["expected_goals"] ?? null,
    };
  });
}

async function safeJson(r) {
  try { return await r.json(); } catch { return {}; }
}
