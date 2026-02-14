const MAX_QUESTION_LENGTH = 200;
const MAX_OPTION_LENGTH = 100;
const MIN_OPTIONS = 2;
const MAX_OPTIONS = 8;

function normalizeString(value) {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim();
}

function normalizeOptions(rawOptions) {
  if (!Array.isArray(rawOptions)) {
    return [];
  }

  const dedupe = new Set();
  const options = [];

  for (const rawOption of rawOptions) {
    const option = normalizeString(rawOption);
    if (!option) {
      continue;
    }

    const key = option.toLowerCase();
    if (dedupe.has(key)) {
      continue;
    }

    dedupe.add(key);
    options.push(option);
  }

  return options;
}

function validateCreatePayload(payload) {
  const errors = [];

  const question = normalizeString(payload && payload.question);
  const options = normalizeOptions(payload && payload.options);

  if (!question) {
    errors.push("Question is required.");
  } else if (question.length > MAX_QUESTION_LENGTH) {
    errors.push(`Question must be at most ${MAX_QUESTION_LENGTH} characters.`);
  }

  if (options.length < MIN_OPTIONS) {
    errors.push(`At least ${MIN_OPTIONS} unique options are required.`);
  }

  if (options.length > MAX_OPTIONS) {
    errors.push(`No more than ${MAX_OPTIONS} options are allowed.`);
  }

  const oversizedOption = options.find(
    (option) => option.length > MAX_OPTION_LENGTH
  );
  if (oversizedOption) {
    errors.push(`Each option must be at most ${MAX_OPTION_LENGTH} characters.`);
  }

  if (errors.length > 0) {
    return {
      ok: false,
      errors,
    };
  }

  return {
    ok: true,
    data: {
      question,
      options,
    },
  };
}

module.exports = {
  validateCreatePayload,
  MAX_OPTIONS,
};
