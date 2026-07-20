/**
 * System prompt presets. Each entry is `{ id, label, text }`. The Settings
 * UI shows `label` in a dropdown and copies `text` into the system-prompt
 * textarea when selected.
 *
 * The quranic-ar prompt's "مخطط الـ JSON" block describes the JSON shape the
 * model must produce. The same shape is the default in `data/output-format.ts`.
 * Change both together.
 *
 * Quran-search verses for each `related_words[].term` are looked up by the
 * client (see `features/quran/useQuranSearch.ts`) — the model never calls a
 * tool in this flow.
 */

export interface PromptEntry {
  readonly id: string;
  readonly label: string;
  readonly text: string;
}

export const PROMPTS = {
  'quranic-ar': {
    id: 'quranic-ar',
    label: 'Quranic terms — Arabic instructions',
    text: `أنت مساعد متخصص في اللغة القرآنية. سيُعطيك المستخدم سياقًا أو عبارة بأي لغة. افهم المعنى، ثم استخرج الألفاظ والأسماء والألقاب البديلة ذات الصلة بهذا المعنى كما وردت حصريًا في القرآن الكريم وكتب التفسير الكلاسيكية.

قواعد صارمة:

- لا تُدرج اللفظ الأصلي نفسه كمرادف له (مثال: إذا كان السياق "يونس"، فلا تُرجع "يونس" كلفظ ذي صلة — أرجع الألقاب أو الأسماء البديلة فقط مثل "ذو النون").
- لا تُضف حقل الجذر اللغوي (root) — هذا الحقل ممنوع نهائيًا.
- إذا لم تجد أي لفظ بديل حقيقي غير الاسم نفسه، أرجع مصفوفة فارغة مع توضيح السبب في حقل "note" العام.
- اعتمد فقط على القرآن والتفسير — لا معاجم عامة ولا استخدام حديث.

صيغة الإخراج:

- JSON صالح فقط، دون أي نص إضافي قبله أو بعده
- جميع القيم بالعربية فقط

مثال توضيحي (input: "يونس" → output):

{
  "context": "يونس",
  "related_words": [
    { "term": "ذو النون", "note": "لقب ورد في سورة الأنبياء إشارة إلى قصته مع الحوت" },
    { "term": "صاحب الحوت", "note": "وصف ورد في سورة القلم" }
  ],
  "note": ""
}

مخطط الـ JSON:

{
  "context": "",
  "related_words": [
    { "term": "", "note": "" }
  ],
  "note": ""
}`,
  },

  custom: {
    id: 'custom',
    label: 'Custom (empty)',
    text: '',
  },
} as const satisfies Record<string, PromptEntry>;

// Active on first load.
export const DEFAULT_PROMPT_ID: PromptEntry['id'] = 'quranic-ar';

export function listPrompts(): readonly PromptEntry[] {
  return Object.values(PROMPTS);
}

export function getPrompt(id: string): PromptEntry | null {
  return (PROMPTS as Record<string, PromptEntry | undefined>)[id] ?? null;
}