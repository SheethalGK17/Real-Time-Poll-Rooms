const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const { io: ioClient } = require("socket.io-client");
const { buildServer } = require("../src/server");

async function setupServer() {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "poll-room-presence-"));
  const dataFilePath = path.join(tempDir, "polls.json");
  const instance = buildServer({
    dataFilePath,
    hashSecret: "test-secret-presence",
  });
  await instance.start(0);
  const address = instance.server.address();

  return {
    ...instance,
    baseUrl: `http://127.0.0.1:${address.port}`,
    tempDir,
  };
}

function waitForEventWhere(socket, eventName, predicate, timeoutMs = 2500) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(eventName, onEvent);
      reject(new Error(`Timed out waiting for ${eventName}`));
    }, timeoutMs);

    function onEvent(payload) {
      if (!predicate(payload)) {
        return;
      }
      clearTimeout(timer);
      socket.off(eventName, onEvent);
      resolve(payload);
    }

    socket.on(eventName, onEvent);
  });
}

test("broadcasts live viewer presence per poll room", async () => {
  const instance = await setupServer();
  let socketOne;
  let socketTwo;

  try {
    const create = await request(instance.app)
      .post("/api/polls")
      .send({
        question: "Presence test question?",
        options: ["One", "Two"],
      })
      .expect(201);

    const pollId = create.body.poll.id;

    socketOne = ioClient(instance.baseUrl, { transports: ["websocket"] });
    await waitForEventWhere(socketOne, "connect", () => true);

    const oneViewerPromise = waitForEventWhere(
      socketOne,
      "presence_update",
      (payload) => payload?.viewerCount === 1
    );
    socketOne.emit("join_poll", pollId);
    await oneViewerPromise;

    socketTwo = ioClient(instance.baseUrl, { transports: ["websocket"] });
    await waitForEventWhere(socketTwo, "connect", () => true);

    const twoViewersForOnePromise = waitForEventWhere(
      socketOne,
      "presence_update",
      (payload) => payload?.viewerCount === 2
    );
    const twoViewersForTwoPromise = waitForEventWhere(
      socketTwo,
      "presence_update",
      (payload) => payload?.viewerCount === 2
    );

    socketTwo.emit("join_poll", pollId);

    const [onePayload, twoPayload] = await Promise.all([
      twoViewersForOnePromise,
      twoViewersForTwoPromise,
    ]);

    assert.equal(onePayload.viewerCount, 2);
    assert.equal(twoPayload.viewerCount, 2);
  } finally {
    if (socketOne) {
      socketOne.close();
    }
    if (socketTwo) {
      socketTwo.close();
    }
    await instance.stop();
    await fs.rm(instance.tempDir, { recursive: true, force: true });
  }
});
