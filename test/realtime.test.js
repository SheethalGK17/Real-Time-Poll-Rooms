const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const { io: ioClient } = require("socket.io-client");
const { buildServer } = require("../src/server");

async function setupServer() {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "poll-room-live-"));
  const dataFilePath = path.join(tempDir, "polls.json");
  const instance = buildServer({
    dataFilePath,
    hashSecret: "test-secret-live",
  });
  await instance.start(0);
  const address = instance.server.address();
  return {
    ...instance,
    baseUrl: `http://127.0.0.1:${address.port}`,
    tempDir,
  };
}

function waitForEvent(socket, eventName, timeoutMs = 2000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timed out waiting for ${eventName}`));
    }, timeoutMs);

    socket.once(eventName, (payload) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

test("broadcasts poll updates in real time on vote", async () => {
  const instance = await setupServer();
  let socket;

  try {
    const create = await request(instance.app)
      .post("/api/polls")
      .send({
        question: "Which framework?",
        options: ["React", "Vue"],
      })
      .expect(201);

    const pollId = create.body.poll.id;
    const optionId = create.body.poll.options[0].id;

    socket = ioClient(instance.baseUrl, {
      transports: ["websocket"],
    });

    await waitForEvent(socket, "connect");
    socket.emit("join_poll", pollId);

    const updatePromise = waitForEvent(socket, "poll_update");

    await request(instance.app)
      .post(`/api/polls/${pollId}/votes`)
      .send({ optionId })
      .expect(201);

    const update = await updatePromise;
    assert.equal(update.poll.id, pollId);
    assert.equal(update.poll.totalVotes, 1);
  } finally {
    if (socket) {
      socket.close();
    }
    await instance.stop();
    await fs.rm(instance.tempDir, { recursive: true, force: true });
  }
});
