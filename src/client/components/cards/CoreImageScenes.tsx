import type { ReactElement } from "react";
import type { translate } from "@/client/lib/i18n";

export interface CoreImageScene {
  caption?: string;
  example?: string;
  raw?: string;
  drawing?: ReactElement | null;
}

// Each reviewed scene owns its words and illustration together. A missing
// drawing here is deliberate, even if the old card has a stored SVG.
export function reviewedCoreScene(word: string, pos: string | null, t: typeof translate): CoreImageScene | undefined {
  const ink = "var(--word-text)";
  const accent = "var(--word-accent)";
  const muted = "var(--word-muted)";
  const paper = "var(--word-card)";
  const highlight = "var(--accent)";

  if (word === "grim") return {
    caption: t("她读着报告，神情凝重。用 **grim** 形容这个表情，会让人预感消息可能不好。", "Her brow tightens as she reads the report. Her **grim** expression suggests the news may be bad."),
    example: "Her expression was **grim** as she read the report.",
    drawing: (
      <svg role="img" viewBox="0 0 392 180" aria-label={t("她皱着眉头读手里的报告", "She reads a report with a furrowed brow")}>
        <g fill="none" strokeLinecap="round" strokeLinejoin="round">
          <path d="M45 164H355" stroke="var(--word-border)" />
          <path d="M92 163C93 138 107 123 132 119L149 112L172 115C183 121 193 128 205 139L230 133L240 146L215 163Z" fill={highlight} stroke={accent} strokeWidth="2.1" />
          <path d="M142 96L137 114L150 127L164 116L165 101" fill={paper} stroke={ink} strokeWidth="2" />
          <path d="M121 64C118 44 129 29 148 26C168 22 185 31 190 46L191 57L198 68L192 72C193 89 184 105 171 111C159 116 143 108 138 100C128 103 121 96 122 88" fill={paper} stroke={ink} strokeWidth="2.6" />
          <path d="M117 84C111 70 110 47 119 34C128 19 148 16 170 20C183 23 191 31 192 45C176 47 158 44 148 37C148 51 140 61 132 66V84C128 80 125 78 122 80Z" fill={accent} stroke={accent} strokeWidth="2" />
          <path d="M129 84C124 77 118 81 120 88C121 94 125 97 130 95" fill={paper} stroke={ink} strokeWidth="2" />
          <path d="M151 58Q159 61 168 65M179 63L187 61" stroke={ink} strokeWidth="3" />
          <path d="M151 68Q157 66 165 70M179 70Q183 68 187 70M174 68L171 80L177 82M157 91Q165 86 175 89" stroke={ink} strokeWidth="2.2" />
          <circle cx="162" cy="70" r="1.7" fill={ink} /><circle cx="184" cy="71" r="1.7" fill={ink} />
          <path d="M133 119L143 141L152 130L161 138L172 117M120 142L115 163" stroke={accent} strokeWidth="1.6" />
          <g transform="rotate(10 238 111)">
            <path d="M213 76H259L270 87V145H213Z" fill={paper} stroke={ink} strokeWidth="2" />
            <path d="M259 77V88H269M220 95H250M220 102H259M220 109H245" stroke={muted} strokeWidth="1.8" />
            <path d="M222 131L232 120L240 123L255 114" stroke={accent} strokeWidth="2.6" />
          </g>
          <path d="M214 144L221 139L229 125C231 121 235 124 233 128L231 133L239 126C242 124 244 127 241 131L234 141L228 147L221 149Z" fill={paper} stroke={ink} strokeWidth="1.7" />
          <path d="M200 56L224 44H248" stroke={accent} strokeWidth="1.2" />
          <text x="255" y="48" fill={ink}>{t("眉头紧锁", "Furrowed brow")}</text>
        </g>
      </svg>
    ),
  };

  // The unaccented noun "resume" can also mean a CV.
  if (word === "resume" && (!pos?.trim() || /\b(?:verb|v|vt|vi)\b|动词/i.test(pos))) return {
    caption: t("午休前后谈的是同一个预算问题。用 **resume**，就交代了这场讨论中间停过。", "They come back to the same budget question after lunch. To **resume** the discussion is to pick it up where they left off."),
    example: "After lunch, they **resumed** their discussion.",
    drawing: (
      <svg role="img" viewBox="0 0 392 180" aria-label={t("午休前后，接着讨论同一个预算", "The same budget discussion continues after a lunch break")}>
        <g fill="none" strokeLinecap="round" strokeLinejoin="round">
          <g fill={highlight} stroke={accent} strokeWidth="2">
            <path d="M34 30H111Q118 30 118 37V68Q118 75 111 75H65L54 85V75H34Q27 75 27 68V37Q27 30 34 30Z" />
            <path d="M278 30H355Q362 30 362 37V68Q362 75 355 75H313L302 85V75H278Q271 75 271 68V37Q271 30 278 30Z" />
          </g>
          <path d="M168 57H223C220 71 211 79 196 79C181 79 171 71 168 57ZM181 82H211M189 48Q184 42 188 36M202 48Q197 41 202 34" stroke={muted} strokeWidth="2" />
          <path d="M31 114H147M244 114H360M350 107L360 114L350 121" stroke={accent} strokeWidth="4" />
          <circle cx="33" cy="114" r="4" fill={accent} />
          <path d="M151 114H239" stroke={muted} strokeWidth="1.3" strokeDasharray="2 6" />
          <rect x="188" y="103" width="5" height="22" rx="2" fill={muted} />
          <rect x="198" y="103" width="5" height="22" rx="2" fill={muted} />
          <g fill={ink} textAnchor="middle">
            <text x="72" y="59">{t("预算", "Budget")}</text>
            <text x="317" y="59">{t("预算", "Budget")}</text>
            <text x="73" y="150">{t("开始讨论", "Start talking")}</text>
            <text x="196" y="150">{t("午休", "Lunch break")}</text>
            <text x="316" y="150">{t("接着讨论", "Talk resumes")}</text>
          </g>
        </g>
      </svg>
    ),
  };

  if (word === "spontaneous") return {
    caption: t("演讲刚结束，听众就鼓起掌来。**spontaneous** 点出这阵掌声是听众当下的自然反应，事先没人安排。", "As the speech ends, the audience breaks into applause. The applause is **spontaneous** because it comes naturally, without anyone arranging it."),
    example: "The audience broke into **spontaneous** applause as the speech ended.",
  };
}
