import { useId } from "react";
import { useI18n } from "@/client/lib/i18n";

/** Older cards with these three words already use reviewed illustrations.
 * Their saved explanations are kept when displaying the legacy deep layer. */
export function ReviewedCoreImage({ word }: { word: string }) {
  const { t } = useI18n();
  const id = useId();
  const arrow = `url(#${id})`;
  const ink = "var(--word-text)";
  const accent = "var(--word-accent)";
  const surface = "var(--word-surface)";
  const shared = <defs><marker id={id} markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0 0L8 4L0 8Z" fill={accent} /></marker></defs>;

  if (word === "account") return (
    <svg role="img" className="reviewed-schema-svg" viewBox="0 0 360 230" aria-label={t("把账目或事件记录下来，再向别人说明", "Record money or events, then give an account of them")}>
      {shared}
      <rect x="28" y="32" width="125" height="136" rx="8" fill={surface} stroke={accent} strokeWidth="2" />
      <path d="M55 32V168M67 68H133M67 94H133M67 120H133M67 146H118" stroke={ink} strokeWidth="2" />
      <circle cx="42" cy="65" r="8" fill="var(--word-accent-secondary)" />
      <path d="M38 93L46 97L38 103ZM37 125H47" stroke={accent} strokeWidth="2" fill="none" />
      <path d="M170 100H207" stroke={accent} strokeWidth="2" markerEnd={arrow} />
      <path d="M230 53H326Q336 53 336 65V133Q336 145 324 145H257L230 163V145Q218 145 218 133V65Q218 53 230 53Z" fill={surface} stroke={accent} strokeWidth="2" />
      <path d="M238 79H315M238 100H315M238 121H293" stroke={ink} strokeWidth="2" />
      <text x="90" y="204" textAnchor="middle" fill={ink}>{t("记下账目或事件", "Keep a record")}</text>
      <text x="277" y="204" textAnchor="middle" fill={ink}>{t("讲清来龙去脉", "Give an account")}</text>
    </svg>
  );

  if (word === "compromise") return (
    <svg role="img" className="reviewed-schema-svg" viewBox="0 0 360 300" aria-label={t("双方各退一步达成一致；另一种用法表示保护或标准受到损害", "Both sides give something up to agree; another use means weakening protection or standards")}>
      {shared}
      <text x="180" y="25" textAnchor="middle" fill={ink}>{t("双方让步", "Give something up")}</text>
      <rect x="22" y="45" width="90" height="44" rx="6" fill="none" stroke="var(--word-border)" strokeDasharray="4 3" />
      <rect x="22" y="45" width="65" height="44" rx="6" fill={surface} stroke={accent} strokeWidth="2" />
      <rect x="248" y="45" width="90" height="44" rx="6" fill="none" stroke="var(--word-border)" strokeDasharray="4 3" />
      <rect x="273" y="45" width="65" height="44" rx="6" fill={surface} stroke={accent} strokeWidth="2" />
      <text x="54" y="72" textAnchor="middle" fill={ink}>A</text><text x="306" y="72" textAnchor="middle" fill={ink}>B</text>
      <path d="M75 99L139 122M285 99L221 122" fill="none" stroke={accent} strokeWidth="2" markerEnd={arrow} />
      <rect x="139" y="112" width="82" height="40" rx="6" fill={surface} stroke={accent} strokeWidth="2" />
      <text x="180" y="138" textAnchor="middle" fill={ink}>{t("一致", "Agree")}</text>
      <path d="M24 175H336" stroke="var(--word-border)" />
      <text x="180" y="204" textAnchor="middle" fill={ink}>{t("保护或标准受损", "Protection weakened")}</text>
      <path d="M153 220L180 211L207 220V244Q204 267 180 279Q156 267 153 244Z" fill={surface} stroke={accent} strokeWidth="2" />
      <path d="M186 215L171 235L190 241L174 275" stroke="var(--destructive)" strokeWidth="4" fill="none" />
    </svg>
  );

  if (word !== "assume") return null;
  return (
    <svg role="img" className="reviewed-schema-svg" viewBox="0 0 360 290" aria-label={t("先把一个判断当作真的来行动，或把任务与责任接到自己身上", "Act on an unproven assumption, or take on responsibility")}>
      {shared}
      <text x="180" y="25" textAnchor="middle" fill={ink}>{t("先按一个判断行动", "Treat it as true")}</text>
      <rect x="28" y="46" width="114" height="65" rx="8" fill={surface} stroke={accent} strokeWidth="2" />
      <text x="85" y="73" textAnchor="middle" fill={ink}>{t("假设", "Assumption")}</text>
      <text x="85" y="96" textAnchor="middle" fill="var(--word-accent-secondary)">?</text>
      <path d="M159 78H213" stroke={accent} strokeWidth="2" strokeDasharray="4 3" markerEnd={arrow} />
      <rect x="231" y="46" width="101" height="65" rx="8" fill={surface} stroke={accent} strokeWidth="2" />
      <text x="281" y="85" textAnchor="middle" fill={ink}>{t("行动", "Act")}</text>
      <path d="M24 142H336" stroke="var(--word-border)" />
      <text x="180" y="172" textAnchor="middle" fill={ink}>{t("接过责任", "Take responsibility")}</text>
      <rect x="43" y="195" width="95" height="59" rx="6" fill={surface} stroke={accent} strokeWidth="2" />
      <text x="90" y="232" textAnchor="middle" fill={ink}>{t("任务", "Task")}</text>
      <path d="M153 224H211" stroke={accent} strokeWidth="2" markerEnd={arrow} />
      <circle cx="262" cy="207" r="17" fill={surface} stroke={ink} strokeWidth="2" />
      <path d="M231 263V253Q231 229 262 229Q293 229 293 253V263" fill={surface} stroke={ink} strokeWidth="2" />
    </svg>
  );
}
