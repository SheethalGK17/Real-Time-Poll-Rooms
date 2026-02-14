const form = document.getElementById("create-form");
const optionsRoot = document.getElementById("options");
const optionTemplate = document.getElementById("option-template");
const addOptionButton = document.getElementById("add-option");
const createButton = document.getElementById("create-button");
const formError = document.getElementById("form-error");
const successPanel = document.getElementById("success");
const shareLink = document.getElementById("share-link");
const copyLinkButton = document.getElementById("copy-link");
const openLinkButton = document.getElementById("open-link");
const questionInput = document.getElementById("question");
const questionCount = document.getElementById("question-count");
const optionsReady = document.getElementById("options-ready");
const validationHint = document.getElementById("validation-hint");
const previewQuestion = document.getElementById("preview-question");
const previewOptions = document.getElementById("preview-options");
const previewFootnote = document.getElementById("preview-footnote");
const templatesRoot = document.getElementById("templates");

const MAX_OPTIONS = 8;
const MIN_OPTIONS = 2;
const MAX_QUESTION_LENGTH = 200;
const MAX_OPTION_LENGTH = 100;
const editors = [];

const templates = [
  {
    label: "Sprint Plan",
    question: "What should our team prioritize next sprint?",
    options: ["Performance", "Bug fixes", "New feature", "Refactor"],
  },
  {
    label: "Event Vote",
    question: "Which session should be added to the agenda?",
    options: ["AI workshop", "Career panel", "Project showcase"],
  },
  {
    label: "Team Lunch",
    question: "Where should we go for team lunch?",
    options: ["Italian", "Indian", "Mexican", "Vegan cafe"],
  },
];

function normalize(value) {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim();
}

function hideError() {
  formError.classList.add("hidden");
  formError.textContent = "";
}

function showError(message) {
  formError.textContent = message;
  formError.classList.remove("hidden");
}

function setQuestionCounter() {
  questionCount.textContent = `${questionInput.value.length}/${MAX_QUESTION_LENGTH}`;
}

function getEditorIndex(wrapper) {
  return editors.findIndex((editor) => editor.wrapper === wrapper);
}

function moveOption(index, direction) {
  const target = index + direction;
  if (index < 0 || target < 0 || target >= editors.length) {
    return;
  }

  const current = editors[index];
  editors[index] = editors[target];
  editors[target] = current;

  for (const editor of editors) {
    optionsRoot.appendChild(editor.wrapper);
  }

  updateAll();
}

function removeOption(index) {
  if (editors.length <= MIN_OPTIONS) {
    showError(`At least ${MIN_OPTIONS} options are required.`);
    return;
  }

  const target = editors[index];
  if (!target) {
    return;
  }

  target.wrapper.remove();
  editors.splice(index, 1);
  updateAll();
}

function createOptionInput(initialValue = "") {
  if (editors.length >= MAX_OPTIONS) {
    return;
  }

  const fragment = optionTemplate.content.cloneNode(true);
  const wrapper = fragment.querySelector(".option-editor");
  const input = wrapper.querySelector("input");
  const counter = wrapper.querySelector(".char-counter");
  const upButton = wrapper.querySelector("[data-action='up']");
  const downButton = wrapper.querySelector("[data-action='down']");
  const removeButton = wrapper.querySelector("[data-action='remove']");

  input.value = initialValue;
  counter.textContent = `${input.value.length}/${MAX_OPTION_LENGTH}`;

  input.addEventListener("input", () => {
    counter.textContent = `${input.value.length}/${MAX_OPTION_LENGTH}`;
    updateAll();
  });

  upButton.addEventListener("click", () => {
    moveOption(getEditorIndex(wrapper), -1);
  });

  downButton.addEventListener("click", () => {
    moveOption(getEditorIndex(wrapper), 1);
  });

  removeButton.addEventListener("click", () => {
    removeOption(getEditorIndex(wrapper));
  });

  optionsRoot.appendChild(wrapper);
  editors.push({
    wrapper,
    input,
    upButton,
    downButton,
    removeButton,
  });
}

function getDraft() {
  const question = normalize(questionInput.value);
  const rawOptions = editors.map((editor) => editor.input.value);
  const normalizedOptions = rawOptions.map(normalize).filter(Boolean);

  const uniqueOptions = [];
  const seen = new Set();
  for (const option of normalizedOptions) {
    const key = option.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    uniqueOptions.push(option);
  }

  const errors = [];
  if (!question) {
    errors.push("Question is required.");
  }
  if (question.length > MAX_QUESTION_LENGTH) {
    errors.push(`Question must be at most ${MAX_QUESTION_LENGTH} characters.`);
  }
  if (uniqueOptions.length < MIN_OPTIONS) {
    errors.push(`At least ${MIN_OPTIONS} unique options are required.`);
  }
  if (uniqueOptions.length > MAX_OPTIONS) {
    errors.push(`No more than ${MAX_OPTIONS} options are allowed.`);
  }
  if (normalizedOptions.some((option) => option.length > MAX_OPTION_LENGTH)) {
    errors.push(`Each option must be at most ${MAX_OPTION_LENGTH} characters.`);
  }

  return {
    question,
    rawOptions,
    uniqueOptions,
    isValid: errors.length === 0,
    errors,
  };
}

function renderPreview(draft) {
  previewQuestion.textContent = draft.question || "Your question will appear here.";
  previewOptions.innerHTML = "";

  const normalizedCounts = new Map();
  const displayOptions = draft.rawOptions.map((value) => normalize(value)).filter(Boolean);
  for (const option of displayOptions) {
    const key = option.toLowerCase();
    normalizedCounts.set(key, (normalizedCounts.get(key) || 0) + 1);
  }

  if (displayOptions.length === 0) {
    const item = document.createElement("li");
    item.textContent = "Options will appear as you type.";
    previewOptions.appendChild(item);
  } else {
    for (const option of displayOptions) {
      const item = document.createElement("li");
      const key = option.toLowerCase();
      const duplicate = (normalizedCounts.get(key) || 0) > 1;
      item.textContent = duplicate ? `${option} (duplicate)` : option;
      if (duplicate) {
        item.classList.add("duplicate");
      }
      previewOptions.appendChild(item);
    }
  }

  previewFootnote.textContent = `${draft.uniqueOptions.length} unique options ready`;
}

function updateValidationHint(draft) {
  if (draft.isValid) {
    validationHint.textContent = "Looks good. Your poll is ready to publish.";
    validationHint.classList.remove("error");
    return;
  }

  validationHint.textContent = draft.errors[0];
  validationHint.classList.add("error");
}

function updateEditorControls() {
  addOptionButton.disabled = editors.length >= MAX_OPTIONS;
  optionsReady.textContent = `${getDraft().uniqueOptions.length} ready`;

  for (const [index, editor] of editors.entries()) {
    editor.upButton.disabled = index === 0;
    editor.downButton.disabled = index === editors.length - 1;
    editor.removeButton.disabled = editors.length <= MIN_OPTIONS;
  }
}

function updateAll() {
  setQuestionCounter();
  updateEditorControls();
  const draft = getDraft();
  updateValidationHint(draft);
  renderPreview(draft);
  createButton.disabled = !draft.isValid;
}

function resetOptions() {
  for (const editor of editors) {
    editor.wrapper.remove();
  }
  editors.length = 0;
}

function applyTemplate(template) {
  questionInput.value = template.question;
  resetOptions();
  for (const option of template.options.slice(0, MAX_OPTIONS)) {
    createOptionInput(option);
  }
  while (editors.length < MIN_OPTIONS) {
    createOptionInput();
  }
  hideError();
  updateAll();
}

function renderTemplates() {
  templatesRoot.innerHTML = "";
  for (const template of templates) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "template-chip";
    button.textContent = template.label;
    button.addEventListener("click", () => applyTemplate(template));
    templatesRoot.appendChild(button);
  }
}

function setFormDisabled(disabled) {
  const fields = form.querySelectorAll("input, button");
  for (const field of fields) {
    field.disabled = disabled;
  }

  const templateButtons = templatesRoot.querySelectorAll("button");
  for (const button of templateButtons) {
    button.disabled = disabled;
  }
}

function collectOptions() {
  return editors.map((editor) => editor.input.value);
}

async function createPoll(question, options) {
  const response = await fetch("/api/polls", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question, options }),
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const reason = Array.isArray(body.details)
      ? body.details.join(" ")
      : body.error || "Unable to create poll.";
    throw new Error(reason);
  }

  return body;
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  hideError();

  const draft = getDraft();
  if (!draft.isValid) {
    showError(draft.errors[0]);
    return;
  }

  setFormDisabled(true);
  createButton.textContent = "Creating...";

  try {
    const result = await createPoll(draft.question, collectOptions());
    shareLink.textContent = result.shareUrl;
    shareLink.href = result.shareUrl;
    successPanel.classList.remove("hidden");
    successPanel.scrollIntoView({ behavior: "smooth", block: "nearest" });
  } catch (error) {
    showError(error.message);
  } finally {
    setFormDisabled(false);
    createButton.textContent = "Create Poll";
    updateAll();
  }
});

questionInput.addEventListener("input", () => {
  hideError();
  updateAll();
});

addOptionButton.addEventListener("click", () => {
  if (editors.length >= MAX_OPTIONS) {
    showError(`A maximum of ${MAX_OPTIONS} options is allowed.`);
    return;
  }

  hideError();
  createOptionInput();
  updateAll();
});

copyLinkButton.addEventListener("click", async () => {
  const link = shareLink.href;
  if (!link) {
    return;
  }

  try {
    await navigator.clipboard.writeText(link);
    copyLinkButton.textContent = "Copied";
    setTimeout(() => {
      copyLinkButton.textContent = "Copy link";
    }, 1200);
  } catch (_error) {
    showError("Clipboard access failed. Copy the link manually.");
  }
});

openLinkButton.addEventListener("click", () => {
  const link = shareLink.href;
  if (!link) {
    return;
  }
  window.location.assign(link);
});

renderTemplates();
createOptionInput();
createOptionInput();
updateAll();
