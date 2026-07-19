// Schema presets for the structured-extraction panel. Each entry is
// `{ id, label, description, schema }`. The `custom` entry has no built-in
// schema — the user supplies one as JSON in the panel.
//
// LiteRT-LM supports a JSON-Schema subset (see assertValidLiteRtSchema in
// chat.js): root type can be object/array/string/number/integer/boolean/null;
// `properties` and `items` are normal objects; `required` is an array of
// strings. Anything else (oneOf, allOf, $ref, regex patterns) is rejected at
// click time, so add new presets carefully — keep them inside the supported
// subset or the runtime will silently drop the unsupported piece.

export const SCHEMAS = {
  user: {
    id: 'user',
    label: 'User record',
    description: 'Extract a single user record from a log line.',
    schema: {
      type: 'object',
      properties: {
        userId:   { type: 'integer',                 description: 'Numeric user ID.' },
        role:     { type: 'string',  enum: ['admin', 'member', 'guest'], description: 'Account role.' },
        isActive: { type: 'boolean',                 description: 'Whether the account is active.' },
      },
      required: ['userId', 'role', 'isActive'],
      additionalProperties: false,
    },
    placeholder:
      'userId=42 role=admin active=true logged in from 10.0.0.1 at 2026-07-19T14:00:00Z',
  },

  quranicTerms: {
    id: 'quranicTerms',
    label: 'Quranic terms (Arabic)',
    description: 'List Quranic terms related to the given context.',
    schema: {
      type: 'object',
      properties: {
        context: {
          type: 'string',
          description: 'The original context, written entirely in Arabic.',
        },
        related_words: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              term: { type: 'string' },
              root: { type: 'string' },
              note: { type: 'string' },
            },
            required: ['term'],
            additionalProperties: false,
          },
        },
        note: { type: 'string' },
      },
      required: ['context', 'related_words'],
      additionalProperties: false,
    },
    placeholder: 'يونس',
  },

  contact: {
    id: 'contact',
    label: 'Contact card',
    description: 'Extract a single contact record.',
    schema: {
      type: 'object',
      properties: {
        name:  { type: 'string' },
        email: { type: 'string' },
        phone: { type: 'string' },
      },
      required: ['name'],
      additionalProperties: false,
    },
    placeholder: 'Reach Jane Doe at jane@example.com or +1-555-123-4567.',
  },

  custom: {
    id: 'custom',
    label: 'Custom JSON schema',
    description: 'Bring your own JSON Schema.',
    schema: null,
    placeholder:
      '{"type":"object","properties":{"n":{"type":"integer","minimum":1,"maximum":10}},"required":["n"]}',
  },
};

export const DEFAULT_SCHEMA_ID = 'user';

export function listSchemas() {
  return Object.values(SCHEMAS);
}

export function getSchema(id) {
  return SCHEMAS[id] ?? null;
}
