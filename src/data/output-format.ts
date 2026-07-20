/**
 * Default JSON-Schema shown in the Settings panel.
 *
 * This is a JSON-Schema definition (NOT an example output). The runtime
 * constrained-decoder in LiteRT-LM requires:
 *   - root.type === 'object'
 *   - properties / items as nested objects
 *   - required as a string array
 * and rejects anything else (oneOf, allOf, $ref, regex patterns, etc.).
 * See `services/chat.ts` for the validation subset.
 *
 * The default below is the quranic-terms shape — aligned with the system
 * prompt at `data/prompts.ts` (`quranic-ar`).
 */

export const DEFAULT_OUTPUT_FORMAT = JSON.stringify(
  {
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
  },
  null,
  2,
);

/**
 * Subset of JSON Schema accepted by the LiteRT-LM constrained decoder.
 * Used by `parsedOutputSchemaAtom` for live validation in the editor.
 */
export interface LiteRtSchemaNode {
  type: 'object' | 'string' | 'number' | 'integer' | 'boolean' | 'array';
  properties?: Record<string, LiteRtSchemaNode>;
  items?: LiteRtSchemaNode;
  required?: string[];
  additionalProperties?: boolean;
}