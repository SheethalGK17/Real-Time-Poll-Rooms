const cookieParser = require("cookie-parser");
const crypto = require("node:crypto");
const http = require("node:http");
const path = require("node:path");
const express = require("express");
const helmet = require("helmet");
const { Server } = require("socket.io");
const { PollStore } = require("./datastore");
const { validateCreatePayload } = require("./validation");

const DEFAULT_PORT = Number(process.env.PORT) || 3000;
const TOKEN_COOKIE = "poll_voter_token";
const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;
const ROOM_PREFIX = "poll:";
const ATTEMPT_WINDOW_MS = 60 * 1000;
const MAX_ATTEMPTS_PER_WINDOW = 10;

function sha256(secret, value) {
  return crypto.createHash("sha256").update(`${secret}:${value}`).digest("hex");
}

function getClientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim().length > 0) {
    return forwarded.split(",")[0].trim();
  }

  return req.ip || req.socket.remoteAddress || "unknown";
}

function createVoterHashes(req, hashSecret) {
  const userAgent = String(req.headers["user-agent"] || "unknown");
  const ip = getClientIp(req);

  return {
    voterTokenHash: sha256(hashSecret, req.voterToken),
    fingerprintHash: sha256(hashSecret, `${ip}|${userAgent}`),
  };
}

function buildServer(config = {}) {
  const dataDir =
    config.dataDir || process.env.DATA_DIR || path.join(__dirname, "..", "data");
  const dataFilePath = config.dataFilePath || path.join(dataDir, "polls.json");
  const hashSecret = config.hashSecret || process.env.HASH_SECRET || "change-me";

  const app = express();
  const server = http.createServer(app);
  const io = new Server(server);
  const store = new PollStore(dataFilePath);
  const voteAttempts = new Map();
  const socketPollMap = new Map();

  function roomName(pollId) {
    return `${ROOM_PREFIX}${pollId}`;
  }

  function emitPresence(pollId) {
    const room = roomName(pollId);
    const viewerCount = io.sockets.adapter.rooms.get(room)?.size || 0;
    io.to(room).emit("presence_update", { viewerCount });
  }

  function consumeVoteAttempt(key) {
    const now = Date.now();
    const existing = voteAttempts.get(key) || [];
    const active = existing.filter((timestamp) => now - timestamp < ATTEMPT_WINDOW_MS);
    active.push(now);
    voteAttempts.set(key, active);
    return active.length > MAX_ATTEMPTS_PER_WINDOW;
  }

  const cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [key, attempts] of voteAttempts.entries()) {
      const active = attempts.filter((timestamp) => now - timestamp < ATTEMPT_WINDOW_MS);
      if (active.length === 0) {
        voteAttempts.delete(key);
      } else {
        voteAttempts.set(key, active);
      }
    }
  }, ATTEMPT_WINDOW_MS);
  cleanupTimer.unref();

  app.set("trust proxy", true);
  app.use(
    helmet({
      contentSecurityPolicy: false,
    })
  );
  app.use(express.json({ limit: "32kb" }));
  app.use(cookieParser());

  app.use((req, res, next) => {
    let token = req.cookies[TOKEN_COOKIE];

    if (!token || typeof token !== "string" || token.length < 10) {
      token = crypto.randomUUID();
      res.cookie(TOKEN_COOKIE, token, {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        maxAge: ONE_YEAR_MS,
      });
    }

    req.voterToken = token;
    next();
  });

  app.post("/api/polls", async (req, res) => {
    const validation = validateCreatePayload(req.body);
    if (!validation.ok) {
      res.status(400).json({
        error: "Invalid poll payload.",
        details: validation.errors,
      });
      return;
    }

    const poll = await store.createPoll(
      validation.data.question,
      validation.data.options
    );

    res.status(201).json({
      poll,
      shareUrl: `${req.protocol}://${req.get("host")}/poll/${poll.id}`,
    });
  });

  app.get("/api/polls/:pollId", (req, res) => {
    const poll = store.getPoll(req.params.pollId);
    if (!poll) {
      res.status(404).json({
        error: "Poll not found.",
      });
      return;
    }

    const hashes = createVoterHashes(req, hashSecret);
    const voteState = store.getVoteState(
      req.params.pollId,
      hashes.voterTokenHash,
      hashes.fingerprintHash
    );

    res.json({
      poll,
      hasVoted: voteState.hasVoted,
      votedOptionId: voteState.optionId,
    });
  });

  app.post("/api/polls/:pollId/votes", async (req, res) => {
    const optionId =
      typeof req.body?.optionId === "string" ? req.body.optionId.trim() : "";
    if (!optionId) {
      res.status(400).json({
        error: "Option is required.",
      });
      return;
    }

    const hashes = createVoterHashes(req, hashSecret);
    const limiterKey = `${req.params.pollId}:${hashes.fingerprintHash}`;
    if (consumeVoteAttempt(limiterKey)) {
      res.status(429).json({
        error: "Too many attempts. Please wait a minute and try again.",
      });
      return;
    }

    const result = await store.castVote({
      pollId: req.params.pollId,
      optionId,
      voterTokenHash: hashes.voterTokenHash,
      fingerprintHash: hashes.fingerprintHash,
    });

    if (!result.ok) {
      if (result.code === "poll_not_found") {
        res.status(404).json({ error: "Poll not found." });
        return;
      }

      if (result.code === "invalid_option") {
        res.status(400).json({ error: "Invalid option." });
        return;
      }

      if (
        result.code === "already_voted_token" ||
        result.code === "already_voted_fingerprint"
      ) {
        res.status(409).json({
          error: "A vote from this voter/session was already recorded.",
          votedOptionId: result.optionId,
        });
        return;
      }

      res.status(500).json({ error: "Unexpected vote failure." });
      return;
    }

    io.to(roomName(req.params.pollId)).emit("poll_update", {
      poll: result.poll,
      lastVoteOptionId: optionId,
      updatedAt: result.poll.updatedAt,
    });

    res.status(201).json({
      poll: result.poll,
      votedOptionId: optionId,
    });
  });

  const publicDir = path.join(__dirname, "..", "public");
  app.use(express.static(publicDir));

  app.get("/", (_req, res) => {
    res.sendFile(path.join(publicDir, "index.html"));
  });

  app.get("/poll/:pollId", (_req, res) => {
    res.sendFile(path.join(publicDir, "poll.html"));
  });

  app.use("/api", (_req, res) => {
    res.status(404).json({ error: "API route not found." });
  });

  io.on("connection", (socket) => {
    socket.on("join_poll", (pollId) => {
      if (typeof pollId !== "string" || !/^[a-f0-9]{10}$/.test(pollId)) {
        return;
      }

      const previousPollId = socketPollMap.get(socket.id);
      if (previousPollId && previousPollId !== pollId) {
        socket.leave(roomName(previousPollId));
        emitPresence(previousPollId);
      }

      socket.join(roomName(pollId));
      socketPollMap.set(socket.id, pollId);
      emitPresence(pollId);
    });

    socket.on("disconnect", () => {
      const pollId = socketPollMap.get(socket.id);
      socketPollMap.delete(socket.id);
      if (pollId) {
        emitPresence(pollId);
      }
    });
  });

  function start(port = DEFAULT_PORT) {
    return store.init().then(
      () =>
        new Promise((resolve) => {
          server.listen(port, () => {
            resolve();
          });
        })
    );
  }

  function stop() {
    return new Promise((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }

  return {
    app,
    io,
    server,
    store,
    start,
    stop,
  };
}

if (require.main === module) {
  const instance = buildServer();
  instance
    .start(DEFAULT_PORT)
    .then(() => {
      // eslint-disable-next-line no-console
      console.log(`Real-Time Poll Rooms running on http://localhost:${DEFAULT_PORT}`);
    })
    .catch((error) => {
      // eslint-disable-next-line no-console
      console.error("Startup failed:", error);
      process.exitCode = 1;
    });
}

module.exports = {
  buildServer,
};
