const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const { buildServer } = require("../src/server");

async function setupServer() {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "poll-room-"));
  const dataFilePath = path.join(tempDir, "polls.json");
  const instance = buildServer({
    dataFilePath,
    hashSecret: "test-secret",
  });
  await instance.store.init();
  return {
    ...instance,
    tempDir,
  };
}

test("creates poll and stores votes with duplicate protection", async () => {
  const instance = await setupServer();

  try {
    const firstAgent = request.agent(instance.app);
    const create = await firstAgent
      .post("/api/polls")
      .send({
        question: "Which language should we use?",
        options: ["TypeScript", "Go"],
      })
      .expect(201);

    const pollId = create.body.poll.id;
    const firstOptionId = create.body.poll.options[0].id;
    const secondOptionId = create.body.poll.options[1].id;

    await firstAgent
      .post(`/api/polls/${pollId}/votes`)
      .send({ optionId: firstOptionId })
      .expect(201);

    await firstAgent
      .post(`/api/polls/${pollId}/votes`)
      .send({ optionId: secondOptionId })
      .expect(409);

    const secondAgent = request.agent(instance.app);
    await secondAgent
      .post(`/api/polls/${pollId}/votes`)
      .send({ optionId: secondOptionId })
      .expect(409);

    const poll = await firstAgent.get(`/api/polls/${pollId}`).expect(200);
    assert.equal(poll.body.poll.totalVotes, 1);
    assert.equal(poll.body.hasVoted, true);
  } finally {
    await fs.rm(instance.tempDir, { recursive: true, force: true });
  }
});

test("validates poll payload and option constraints", async () => {
  const instance = await setupServer();

  try {
    await request(instance.app)
      .post("/api/polls")
      .send({
        question: " ",
        options: ["One"],
      })
      .expect(400);

    const create = await request(instance.app)
      .post("/api/polls")
      .send({
        question: "Preferred deployment target?",
        options: ["Render", "render", "Railway", ""],
      })
      .expect(201);

    assert.equal(create.body.poll.options.length, 2);
  } finally {
    await fs.rm(instance.tempDir, { recursive: true, force: true });
  }
});
