// Default output-format JSON shown in the Settings panel.
// This is a JSON-Schema definition (NOT an example output) — the runtime
// constrained-decoder in LiteRT-LM requires:
//   - root.type === 'object'
//   - properties / items as nested objects
//   - required as a string array
// and rejects anything else (oneOf, allOf, $ref, regex patterns, etc.).
// See assertValidLiteRtSchema() in src/chat.js for the full subset.
//
// The default below is the quranic-terms shape — aligned with the system
// prompt at src/prompts.js (quranic-ar).

export const DEFAULT_OUTPUT_FORMAT = JSON.stringify({
  type: 'object',
  properties: {
    context: { type: 'string' },
    related_words: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          term: { type: 'string' },
          note: { type: 'string' },
        },
        required: ['term', 'note'],
        additionalProperties: false,
      },
    },
    note: { type: 'string' },
  },
  required: ['context', 'related_words'],
  additionalProperties: false,
}, null, 2);
