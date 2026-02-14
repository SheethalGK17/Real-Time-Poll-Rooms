const pollId = window.location.pathname.split("/").filter(Boolean).pop();
const optionsRoot = document.getElementById("options");
const pollQuestion = document.getElementById("poll-question");
const pollMeta = document.getElementById("poll-meta");
const pollError = document.getElementById("poll-error");
const statusLine = document.getElementById("status");
const connectionChip = document.getElementById("connection");
const viewerChip = document.getElementById("viewer-chip");
const voteStat = document.getElementById("stat-votes");
const viewerStat = document.getElementById("stat-viewers");
const sortToggle = document.getElementById("sort-toggle");
const activityFeed = document.getElementById("activity-feed");
const activityTemplate = document.getElementById("activity-item-template");
const optionTemplate = document.getElementById("option-card-template");

const state = {
  poll: null,
  hasVoted: false,
  votedOptionId: null,
  voteSubmitting: false,
  viewerCount: null,
  sortMode: "default",
  highlightOptionId: null,
  activity: [],
  suppressActivityForUpdatedAt: null,
};

function setConnection(status, label) {
  connectionChip.textContent = label;
  connectionChip.classList.remove("chip-muted", "chip-ok", "chip-bad");
  connectionChip.classList.add(status);
}

function showError(message) {
  pollError.textContent = message;
  pollError.classList.remove("hidden");
}

function hideError() {
  pollError.classList.add("hidden");
  pollError.textContent = "";
}

function showStatus(message) {
  statusLine.textContent = message;
  statusLine.classList.remove("hidden");
}

function hideStatus() {
  statusLine.classList.add("hidden");
  statusLine.textContent = "";
}

function formatAgo(timestamp) {
  const elapsedSeconds = Math.max(1, Math.floor((Date.now() - timestamp) / 1000));
  if (elapsedSeconds < 60) {
    return `${elapsedSeconds}s ago`;
  }
  const elapsedMinutes = Math.floor(elapsedSeconds / 60);
  if (elapsedMinutes < 60) {
    return `${elapsedMinutes}m ago`;
  }
  const elapsedHours = Math.floor(elapsedMinutes / 60);
  return `${elapsedHours}h ago`;
}

function updateStats() {
  if (!state.poll) {
    return;
  }

  voteStat.textContent = String(state.poll.totalVotes);
  if (typeof state.viewerCount === "number") {
    const label = state.viewerCount === 1 ? "viewer" : "viewers";
    viewerStat.textContent = String(state.viewerCount);
    viewerChip.textContent = `${state.viewerCount} ${label}`;
  } else {
    viewerStat.textContent = "-";
    viewerChip.textContent = "0 viewers";
  }
}

function addActivity(message) {
  state.activity.unshift({
    message,
    createdAt: Date.now(),
  });

  if (state.activity.length > 12) {
    state.activity.length = 12;
  }
  renderActivity();
}

function renderActivity() {
  activityFeed.innerHTML = "";

  if (state.activity.length === 0) {
    const item = document.createElement("li");
    item.className = "activity-item";
    item.innerHTML =
      '<span class="activity-text">Waiting for votes...</span><span class="activity-time">Live updates will appear here.</span>';
    activityFeed.appendChild(item);
    return;
  }

  for (const entry of state.activity) {
    const fragment = activityTemplate.content.cloneNode(true);
    fragment.querySelector(".activity-text").textContent = entry.message;
    fragment.querySelector(".activity-time").textContent = formatAgo(entry.createdAt);
    activityFeed.appendChild(fragment);
  }
}

function getSortedOptions() {
  if (!state.poll) {
    return [];
  }

  const options = [...state.poll.options];
  if (state.sortMode === "top") {
    options.sort((left, right) => right.votes - left.votes);
  }
  return options;
}

function createOptionElement(option) {
  const fragment = optionTemplate.content.cloneNode(true);
  const card = fragment.querySelector(".option-card");
  const voteButton = fragment.querySelector(".vote-button");
  const result = fragment.querySelector(".option-result");
  const fill = fragment.querySelector(".bar-fill");

  voteButton.textContent = option.text;
  voteButton.disabled = state.hasVoted || state.voteSubmitting;
  voteButton.addEventListener("click", () => submitVote(option.id));

  if (state.votedOptionId === option.id) {
    voteButton.classList.remove("btn-light");
    voteButton.classList.add("btn-primary");
  }

  const voteLabel = option.votes === 1 ? "vote" : "votes";
  result.textContent = `${option.votes} ${voteLabel} (${option.percent}%)`;
  fill.style.width = `${option.percent}%`;

  if (state.highlightOptionId === option.id) {
    card.classList.add("pulse");
  }

  return fragment;
}

function renderPoll() {
  if (!state.poll) {
    return;
  }

  pollQuestion.textContent = state.poll.question;
  const votedText = state.hasVoted ? "Your vote is locked." : "You can vote once.";
  pollMeta.textContent = `${state.poll.totalVotes} total votes. ${votedText}`;

  optionsRoot.innerHTML = "";
  for (const option of getSortedOptions()) {
    optionsRoot.appendChild(createOptionElement(option));
  }

  updateStats();
}

async function loadPoll() {
  hideError();

  const response = await fetch(`/api/polls/${encodeURIComponent(pollId)}`);
  const body = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(body.error || "Failed to load poll.");
  }

  state.poll = body.poll;
  state.hasVoted = Boolean(body.hasVoted);
  state.votedOptionId = body.votedOptionId || null;
  renderPoll();
}

function optionName(optionId) {
  if (!state.poll) {
    return "an option";
  }
  return state.poll.options.find((option) => option.id === optionId)?.text || "an option";
}

async function submitVote(optionId) {
  if (state.hasVoted || state.voteSubmitting) {
    return;
  }

  hideError();
  hideStatus();
  state.voteSubmitting = true;
  renderPoll();

  try {
    const response = await fetch(`/api/polls/${encodeURIComponent(pollId)}/votes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ optionId }),
    });

    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 409) {
        state.hasVoted = true;
        state.votedOptionId = body.votedOptionId || null;
        await loadPoll();
        showStatus("A vote from this session/network was already recorded.");
        return;
      }
      throw new Error(body.error || "Vote failed.");
    }

    state.hasVoted = true;
    state.votedOptionId = body.votedOptionId;
    state.poll = body.poll;
    state.highlightOptionId = body.votedOptionId;
    state.suppressActivityForUpdatedAt = body.poll.updatedAt;
    addActivity(`New vote for "${optionName(body.votedOptionId)}".`);
    showStatus("Vote submitted.");
  } catch (error) {
    showError(error.message);
  } finally {
    state.voteSubmitting = false;
    renderPoll();
    setTimeout(() => {
      state.highlightOptionId = null;
      renderPoll();
    }, 850);
  }
}

function handlePollUpdate(payload) {
  if (!payload || !payload.poll) {
    return;
  }

  state.poll = payload.poll;
  state.highlightOptionId =
    typeof payload.lastVoteOptionId === "string" ? payload.lastVoteOptionId : null;

  if (
    state.highlightOptionId &&
    payload.updatedAt !== state.suppressActivityForUpdatedAt
  ) {
    addActivity(`New vote for "${optionName(state.highlightOptionId)}".`);
  }
  state.suppressActivityForUpdatedAt = null;

  renderPoll();
  if (state.highlightOptionId) {
    setTimeout(() => {
      state.highlightOptionId = null;
      renderPoll();
    }, 850);
  }
}

function updateViewerCount(viewerCount) {
  if (typeof viewerCount !== "number") {
    return;
  }
  state.viewerCount = viewerCount;
  updateStats();
}

async function init() {
  if (!pollId || !/^[a-f0-9]{10}$/.test(pollId)) {
    showError("Invalid poll URL.");
    return;
  }

  try {
    await loadPoll();
  } catch (error) {
    showError(error.message);
    return;
  }

  const socket = io();
  socket.on("connect", () => {
    setConnection("chip-ok", "Live");
    socket.emit("join_poll", pollId);
  });

  socket.on("disconnect", () => {
    setConnection("chip-bad", "Disconnected");
  });

  socket.on("poll_update", handlePollUpdate);
  socket.on("presence_update", (payload) => {
    updateViewerCount(payload?.viewerCount);
  });
}

sortToggle.addEventListener("click", () => {
  state.sortMode = state.sortMode === "default" ? "top" : "default";
  sortToggle.textContent =
    state.sortMode === "default" ? "Top results" : "Original order";
  renderPoll();
});

setInterval(() => {
  if (state.activity.length > 0) {
    renderActivity();
  }
}, 10000);

setConnection("chip-muted", "Connecting...");
renderActivity();
init();
