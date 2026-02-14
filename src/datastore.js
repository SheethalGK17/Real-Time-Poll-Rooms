const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");

const DEFAULT_STATE = {
  polls: {},
  votes: [],
};

function createId(size = 12) {
  return crypto.randomBytes(Math.ceil(size / 2)).toString("hex").slice(0, size);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

class PollStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.state = clone(DEFAULT_STATE);
    this.writeQueue = Promise.resolve();
  }

  async init() {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });

    let raw;
    try {
      raw = await fs.readFile(this.filePath, "utf8");
    } catch (error) {
      if (error.code === "ENOENT") {
        this.state = clone(DEFAULT_STATE);
        await this.persist();
        return;
      }
      throw error;
    }

    const trimmed = raw.trim();
    if (!trimmed) {
      this.state = clone(DEFAULT_STATE);
      await this.persist();
      return;
    }

    try {
      const parsed = JSON.parse(trimmed);
      this.state = this.normalizeState(parsed);
    } catch (_error) {
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const backupPath = `${this.filePath}.corrupt-${stamp}`;
      await fs.writeFile(backupPath, raw, "utf8").catch(() => {});
      this.state = clone(DEFAULT_STATE);
      await this.persist();
    }
  }

  normalizeState(raw) {
    if (!raw || typeof raw !== "object") {
      return clone(DEFAULT_STATE);
    }

    const polls = raw.polls && typeof raw.polls === "object" ? raw.polls : {};
    const votes = Array.isArray(raw.votes) ? raw.votes : [];

    return {
      polls,
      votes,
    };
  }

  async persist() {
    const tempPath = `${this.filePath}.tmp`;
    const body = JSON.stringify(this.state, null, 2);
    await fs.writeFile(tempPath, body, "utf8");
    await fs.rename(tempPath, this.filePath);
  }

  async withWrite(mutator) {
    const operation = this.writeQueue.then(async () => {
      const result = await mutator(this.state);
      await this.persist();
      return result;
    });

    this.writeQueue = operation.catch(() => {});
    return operation;
  }

  toPublicPoll(poll) {
    const options = poll.options.map((option) => {
      const votes = poll.voteCounts[option.id] || 0;
      const percent =
        poll.totalVotes === 0
          ? 0
          : Number(((votes / poll.totalVotes) * 100).toFixed(1));

      return {
        id: option.id,
        text: option.text,
        votes,
        percent,
      };
    });

    return {
      id: poll.id,
      question: poll.question,
      options,
      totalVotes: poll.totalVotes,
      createdAt: poll.createdAt,
      updatedAt: poll.updatedAt,
    };
  }

  async createPoll(question, optionTexts) {
    return this.withWrite((state) => {
      const pollId = createId(10);
      const now = new Date().toISOString();

      const options = optionTexts.map((text) => ({
        id: createId(8),
        text,
      }));

      const voteCounts = {};
      for (const option of options) {
        voteCounts[option.id] = 0;
      }

      const poll = {
        id: pollId,
        question,
        options,
        voteCounts,
        totalVotes: 0,
        createdAt: now,
        updatedAt: now,
      };

      state.polls[pollId] = poll;
      return this.toPublicPoll(poll);
    });
  }

  getPoll(pollId) {
    const poll = this.state.polls[pollId];
    if (!poll) {
      return null;
    }
    return this.toPublicPoll(poll);
  }

  getVoteState(pollId, voterTokenHash, fingerprintHash) {
    let tokenMatch = null;
    let fingerprintMatch = null;

    for (const vote of this.state.votes) {
      if (vote.pollId !== pollId) {
        continue;
      }
      if (!tokenMatch && vote.voterTokenHash === voterTokenHash) {
        tokenMatch = vote;
      }
      if (!fingerprintMatch && vote.fingerprintHash === fingerprintHash) {
        fingerprintMatch = vote;
      }
      if (tokenMatch && fingerprintMatch) {
        break;
      }
    }

    const match = tokenMatch || fingerprintMatch;
    if (!match) {
      return {
        hasVoted: false,
        optionId: null,
      };
    }

    return {
      hasVoted: true,
      optionId: match.optionId,
      via: tokenMatch ? "token" : "fingerprint",
    };
  }

  async castVote({ pollId, optionId, voterTokenHash, fingerprintHash }) {
    return this.withWrite((state) => {
      const poll = state.polls[pollId];
      if (!poll) {
        return {
          ok: false,
          code: "poll_not_found",
        };
      }

      const option = poll.options.find((entry) => entry.id === optionId);
      if (!option) {
        return {
          ok: false,
          code: "invalid_option",
        };
      }

      const existingByToken = state.votes.find(
        (vote) =>
          vote.pollId === pollId && vote.voterTokenHash === voterTokenHash
      );

      if (existingByToken) {
        return {
          ok: false,
          code: "already_voted_token",
          optionId: existingByToken.optionId,
        };
      }

      const existingByFingerprint = state.votes.find(
        (vote) =>
          vote.pollId === pollId && vote.fingerprintHash === fingerprintHash
      );

      if (existingByFingerprint) {
        return {
          ok: false,
          code: "already_voted_fingerprint",
          optionId: existingByFingerprint.optionId,
        };
      }

      const now = new Date().toISOString();

      state.votes.push({
        id: createId(14),
        pollId,
        optionId,
        voterTokenHash,
        fingerprintHash,
        votedAt: now,
      });

      poll.voteCounts[optionId] += 1;
      poll.totalVotes += 1;
      poll.updatedAt = now;

      return {
        ok: true,
        poll: this.toPublicPoll(poll),
      };
    });
  }
}

module.exports = {
  PollStore,
};
