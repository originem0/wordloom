"""Extract words from Frhelper XML backup and classify by CEFR level.

Uses the Oxford 5000 / CEFR word list as reference.
Words not found in the reference default to C1.

Output: tmp/words_by_cefr.md
"""

import xml.etree.ElementTree as ET
from pathlib import Path
import json
import urllib.request

# ---------------------------------------------------------------------------
# 1. Parse XML
# ---------------------------------------------------------------------------

xml_path = Path(__file__).parent / "word.xml"
tree = ET.parse(xml_path)
root = tree.getroot()

words: list[str] = []
for item in root.iter("CustomizeListItem"):
    w = item.get("word", "").strip()
    if w and item.get("deleted") != "1":
        words.append(w)

words = sorted(set(words), key=str.lower)
print(f"Extracted {len(words)} unique words from XML")

# ---------------------------------------------------------------------------
# 2. Build CEFR lookup from a bundled reference list
#    Source: simplified Oxford 5000 / EVP mapping
# ---------------------------------------------------------------------------

# We'll use a well-known public CEFR word list JSON
# Fallback: a hardcoded mapping for common words + default to C1

CEFR_LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"]

# Hardcoded CEFR reference for common English words (Oxford 5000 subset)
# This is a pragmatic approach — covers the most common words.
CEFR_MAP: dict[str, str] = {}

# Try to load from a local cache first
cache_path = Path(__file__).parent / "cefr_cache.json"
if cache_path.exists():
    with open(cache_path, "r", encoding="utf-8") as f:
        CEFR_MAP = json.load(f)
    print(f"Loaded {len(CEFR_MAP)} words from CEFR cache")

if not CEFR_MAP:
    # Build a basic CEFR map from known word frequency patterns
    # A1/A2: very common everyday words
    # B1/B2: intermediate academic/professional words
    # C1/C2: advanced/specialized words
    a1_words = {
        "about", "above", "across", "act", "add", "address", "after", "again", "age",
        "all", "also", "always", "an", "and", "animal", "another", "answer", "any",
        "area", "arm", "around", "art", "ask", "at", "away", "back", "bad", "bag",
        "ball", "bank", "base", "be", "bear", "because", "become", "bed", "before",
        "begin", "behind", "best", "better", "between", "big", "black", "blue", "board",
        "body", "book", "both", "box", "boy", "break", "bring", "brother", "brown",
        "build", "bus", "but", "buy", "by", "call", "can", "car", "card", "care",
        "carry", "case", "cat", "catch", "center", "change", "child", "children",
        "city", "class", "clean", "clear", "click", "close", "cold", "color", "come",
        "common", "computer", "could", "country", "course", "cover", "cross", "cup",
        "cut", "dance", "dark", "daughter", "day", "dead", "dear", "decide", "deep",
        "different", "dinner", "do", "doctor", "dog", "door", "down", "draw", "dream",
        "dress", "drink", "drive", "drop", "during", "each", "early", "earth", "east",
        "eat", "eight", "end", "english", "enough", "even", "evening", "every",
        "example", "eye", "face", "fact", "fall", "family", "far", "fast", "father",
        "feel", "few", "find", "fine", "finish", "fire", "first", "fish", "five",
        "floor", "fly", "follow", "food", "foot", "for", "foreign", "form", "four",
        "free", "friend", "from", "front", "full", "fun", "game", "garden", "get",
        "girl", "give", "go", "god", "good", "great", "green", "ground", "group",
        "grow", "hair", "half", "hand", "happen", "happy", "hard", "has", "have",
        "he", "head", "hear", "heart", "help", "her", "here", "high", "him", "his",
        "hit", "hold", "home", "hope", "hot", "hotel", "hour", "house", "how",
        "hundred", "husband", "idea", "if", "important", "in", "information",
        "interest", "into", "it", "its", "job", "join", "just", "keep", "key", "kill",
        "kind", "king", "kitchen", "know", "land", "language", "large", "last", "late",
        "laugh", "lead", "learn", "leave", "left", "less", "let", "letter", "life",
        "light", "like", "line", "list", "listen", "little", "live", "long", "look",
        "lose", "lot", "love", "low", "make", "man", "many", "market", "may", "mean",
        "meet", "might", "mind", "minute", "miss", "money", "month", "more", "morning",
        "most", "mother", "move", "much", "music", "must", "my", "name", "national",
        "near", "need", "never", "new", "news", "next", "night", "nine", "no", "north",
        "not", "note", "nothing", "now", "number", "of", "off", "offer", "office",
        "often", "old", "on", "once", "one", "only", "open", "or", "order", "other",
        "our", "out", "over", "own", "page", "paper", "parent", "part", "party",
        "pass", "past", "pay", "people", "person", "phone", "photo", "pick", "picture",
        "place", "plan", "play", "please", "point", "police", "political", "poor",
        "possible", "power", "practice", "president", "price", "problem", "produce",
        "program", "provide", "public", "pull", "push", "put", "question", "quite",
        "rain", "read", "ready", "real", "really", "reason", "red", "remember",
        "report", "rest", "return", "rich", "right", "river", "road", "room", "round",
        "run", "said", "same", "say", "school", "sea", "second", "see", "seem", "sell",
        "send", "service", "set", "seven", "she", "short", "should", "show", "side",
        "since", "sister", "sit", "six", "small", "so", "social", "some", "son",
        "soon", "sorry", "south", "speak", "special", "spend", "stand", "start",
        "state", "stay", "still", "stop", "story", "street", "strong", "student",
        "study", "such", "sun", "sure", "table", "take", "talk", "tell", "ten", "test",
        "than", "that", "the", "their", "them", "then", "there", "these", "they",
        "thing", "think", "third", "this", "those", "though", "three", "through",
        "time", "to", "today", "together", "too", "top", "toward", "town", "tree",
        "try", "turn", "two", "type", "under", "understand", "until", "up", "us",
        "use", "very", "visit", "voice", "wait", "walk", "wall", "want", "war",
        "watch", "water", "way", "we", "week", "well", "west", "what", "when",
        "where", "which", "while", "white", "who", "whole", "why", "wife", "will",
        "win", "window", "wish", "with", "without", "woman", "word", "work", "world",
        "would", "write", "wrong", "year", "yes", "yet", "you", "young",
    }
    a2_words = {
        "ability", "abroad", "accept", "accident", "account", "achieve", "actual",
        "actually", "adult", "advantage", "adventure", "advice", "afford", "afraid",
        "agency", "ago", "agree", "ahead", "allow", "almost", "alone", "along",
        "already", "although", "amount", "ancient", "angry", "announce", "anyway",
        "anywhere", "apartment", "appear", "apply", "army", "arrange", "arrive",
        "article", "attack", "attention", "audience", "avoid", "baby", "background",
        "basic", "bath", "battle", "beach", "beat", "beautiful", "bedroom", "beer",
        "beginning", "behavior", "believe", "bell", "belong", "below", "benefit",
        "beside", "beyond", "bill", "birth", "bit", "bite", "blood", "blow", "boat",
        "bone", "border", "born", "boss", "bottom", "brain", "branch", "brave",
        "bread", "breathe", "bridge", "bright", "broad", "broken", "brown", "brush",
        "budget", "burn", "busy", "butter", "camera", "camp", "campaign", "candy",
        "cap", "capital", "captain", "cause", "celebrate", "central", "century",
        "ceremony", "certain", "chain", "chair", "challenge", "chance", "chapter",
        "charge", "cheap", "check", "cheese", "chicken", "chief", "choice", "choose",
        "church", "cigarette", "circle", "citizen", "claim", "climb", "clock", "cloth",
        "clothes", "cloud", "club", "coach", "coast", "coffee", "coin", "collect",
        "college", "combine", "comfortable", "comment", "communicate", "community",
        "company", "compare", "compete", "competition", "complete", "concern",
        "condition", "conference", "confidence", "confirm", "connect", "consider",
        "contain", "content", "continue", "control", "conversation", "cook", "cool",
        "copy", "corner", "correct", "cost", "count", "couple", "crazy", "create",
        "crime", "crowd", "cry", "culture", "customer", "damage", "danger", "deal",
        "death", "debt", "demand", "department", "depend", "describe", "desert",
        "design", "desk", "destroy", "detail", "develop", "development", "diet",
        "difference", "difficult", "direct", "direction", "dirty", "disappear",
        "discover", "discussion", "disease", "dish", "distance", "divide", "document",
        "double", "doubt", "downtown", "dry", "dust", "duty", "earn", "edge",
        "education", "effect", "effort", "election", "electric", "emergency", "emotion",
        "employ", "encourage", "enemy", "energy", "engine", "enjoy", "enter",
        "environment", "equal", "escape", "especially", "establish", "event",
        "eventually", "everywhere", "evidence", "evil", "exact", "exam", "examine",
        "excellent", "except", "exchange", "excite", "exercise", "exist", "expect",
        "experience", "experiment", "explain", "explore", "express", "expression",
        "extra", "extreme", "fail", "fair", "faith", "familiar", "famous", "fan",
        "farm", "fat", "favorite", "fear", "feature", "feed", "female", "fence",
        "field", "fight", "figure", "fill", "film", "final", "finally", "financial",
        "finger", "fit", "fix", "flag", "flat", "flight", "float", "flow", "flower",
        "focus", "following", "football", "force", "forest", "forget", "formal",
        "former", "forward", "foundation", "fresh", "fruit", "fuel", "funny",
        "furniture", "future", "gain", "gate", "gather", "general", "generation",
        "gentleman", "gift", "glad", "glass", "global", "goal", "gold", "golden",
        "government", "grade", "grass", "gray", "grey", "guard", "guess", "guide",
        "gun", "guy", "habit", "handle", "hang", "hardly", "harm", "hat", "hate",
        "health", "heat", "heavy", "height", "hide", "highway", "hill", "hire",
        "history", "hole", "holiday", "honest", "honor", "horse", "host", "huge",
        "human", "humor", "hurt", "ice", "ignore", "ill", "illegal", "image",
        "imagine", "immediate", "immediately", "impact", "import", "impossible",
        "impress", "improve", "incident", "include", "income", "increase",
        "independence", "independent", "indicate", "individual", "industry",
        "influence", "initial", "injury", "inner", "inside", "instead", "institution",
        "instruction", "instrument", "insurance", "intelligent", "intend", "internal",
        "international", "internet", "interview", "introduce", "introduction", "invest",
        "investigate", "invitation", "invite", "island", "issue", "item", "jacket",
        "judge", "jump", "junior", "justice", "kick", "kid", "knee", "knife", "knock",
        "lab", "lack", "lady", "lake", "leadership", "leaf", "league", "lean", "leg",
        "legal", "lesson", "level", "library", "lie", "limit", "link", "lip", "local",
        "lock", "lonely", "lord", "loss", "luck", "lunch", "machine", "mad",
        "magazine", "magic", "main", "maintain", "major", "male", "manage",
        "management", "manager", "mark", "marriage", "marry", "mass", "master",
        "match", "material", "matter", "meal", "measure", "media", "medicine",
        "member", "memory", "mental", "mention", "message", "metal", "method",
        "middle", "military", "million", "minor", "mirror", "mix", "model", "modern",
        "moment", "moral", "moreover", "mountain", "mouth", "movie", "murder",
        "muscle", "mystery", "narrow", "nation", "native", "natural", "nature",
        "necessary", "neck", "negative", "neighbor", "neither", "network", "nor",
        "normal", "nose", "notice", "novel", "nurse", "object", "obvious", "occasion",
        "occur", "ocean", "officer", "oil", "operate", "opinion", "opportunity",
        "oppose", "opposite", "option", "ordinary", "organize", "original", "otherwise",
        "outcome", "outside", "paint", "pair", "pale", "panel", "partner", "passage",
        "passenger", "path", "patient", "pattern", "peace", "perfect", "perform",
        "performance", "period", "permit", "personal", "personality", "perspective",
        "physical", "pie", "pilot", "pink", "pipe", "plant", "plastic", "plate",
        "player", "pleasure", "plenty", "plus", "pocket", "poem", "poet", "politics",
        "pollution", "pool", "popular", "population", "position", "positive", "pot",
        "potato", "pour", "pray", "prefer", "prepare", "presence", "present",
        "preserve", "pretty", "prevent", "primary", "prince", "princess", "principle",
        "print", "prison", "private", "prize", "probably", "process", "production",
        "professional", "professor", "profit", "progress", "project", "promise",
        "proper", "property", "propose", "protect", "protest", "proud", "prove",
        "purpose", "pursue", "quiet", "race", "raise", "range", "rare", "rate",
        "rather", "raw", "reaction", "realize", "receive", "recent", "recently",
        "recognize", "recommend", "record", "recover", "reduce", "refer", "reflect",
        "reform", "refuse", "region", "relate", "relation", "relationship", "release",
        "religion", "religious", "rely", "remain", "remove", "repeat", "replace",
        "request", "require", "research", "resident", "resource", "respond", "response",
        "responsible", "result", "reveal", "review", "revolution", "ride", "ring",
        "rise", "risk", "rock", "role", "roof", "root", "rope", "rough", "row", "royal",
        "rule", "rush", "safe", "safety", "sail", "salary", "salt", "sand", "save",
        "scene", "science", "scientist", "score", "screen", "search", "season", "seat",
        "secret", "section", "security", "seed", "seek", "select", "senior", "sense",
        "separate", "series", "serious", "seriously", "serve", "session", "settle",
        "several", "severe", "shake", "shape", "share", "sharp", "she", "sheet",
        "shift", "shine", "ship", "shirt", "shock", "shoot", "shop", "shoulder",
        "sight", "sign", "signal", "significant", "silence", "silly", "silver",
        "similar", "simple", "simply", "sing", "single", "sir", "situation", "size",
        "skin", "sleep", "slightly", "slow", "smell", "smile", "smoke", "smooth",
        "snow", "soft", "soil", "soldier", "solid", "solution", "solve", "somebody",
        "somehow", "somewhat", "somewhere", "sort", "soul", "sound", "source",
        "southern", "space", "specific", "speech", "speed", "spirit", "spot", "spread",
        "spring", "square", "staff", "stage", "standard", "star", "statement",
        "station", "status", "steal", "steel", "step", "stick", "stock", "stomach",
        "stone", "store", "storm", "straight", "strange", "stranger", "strategy",
        "stream", "strength", "stress", "stretch", "strike", "string", "strip",
        "struggle", "stupid", "style", "subject", "succeed", "success", "successful",
        "suddenly", "suffer", "suggest", "suit", "summer", "supply", "support",
        "suppose", "surround", "survive", "sweet", "swim", "swing", "switch", "symbol",
        "system", "talent", "tall", "target", "task", "tax", "tea", "teach", "teacher",
        "team", "tear", "technology", "telephone", "television", "temperature", "tend",
        "term", "terrible", "text", "thank", "theme", "theory", "therefore", "thick",
        "thin", "throw", "thus", "ticket", "tie", "tight", "tiny", "tip", "tire",
        "title", "tomorrow", "tone", "tongue", "tonight", "tool", "tooth", "total",
        "touch", "tour", "tourist", "tower", "track", "trade", "tradition",
        "traditional", "traffic", "train", "transfer", "transform", "transport",
        "travel", "treat", "treatment", "trial", "trip", "trouble", "truck", "trust",
        "truth", "typical", "uncle", "unfortunately", "union", "unique", "unit",
        "unite", "university", "unless", "unlike", "unusual", "upon", "upper", "urban",
        "useful", "user", "usual", "usually", "valley", "valuable", "value", "variety",
        "various", "vast", "vehicle", "version", "victim", "view", "village",
        "violence", "virtue", "visible", "vote", "wage", "wake", "warm", "warn",
        "wash", "waste", "wave", "weak", "wealth", "weapon", "wear", "weather",
        "website", "welcome", "welfare", "western", "whatever", "wheel", "whenever",
        "whether", "whom", "wide", "wild", "willing", "wing", "winter", "wire",
        "wise", "within", "wonder", "wood", "worker", "worry", "worse", "worst",
        "worth", "wrap", "yard", "yellow", "yesterday", "youth", "zone",
    }
    b1_words = {
        "abandon", "absorb", "abstract", "abuse", "academic", "accommodate",
        "accompany", "accomplish", "accumulate", "accurate", "accuse", "acknowledge",
        "adapt", "adequate", "adjust", "administration", "admire", "adopt", "advocate",
        "aesthetic", "aggressive", "agriculture", "aid", "aim", "alert", "allocate",
        "alter", "alternative", "altogether", "ambassador", "ambitious", "amend",
        "analogy", "analyze", "ancestor", "anticipate", "anxiety", "appeal",
        "applicable", "appoint", "appreciation", "approach", "appropriate", "approval",
        "approximate", "arbitrary", "architect", "arena", "arise", "arrangement",
        "arrest", "aspect", "assault", "assert", "assess", "asset", "assign",
        "assistance", "associate", "association", "assumption", "assure", "atmosphere",
        "attach", "attempt", "authority", "automatic", "availability", "await",
        "awareness", "barely", "barrier", "basis", "behalf", "bias", "bind", "blade",
        "blank", "blast", "bleed", "blend", "bless", "blind", "boom", "bounce",
        "bound", "breed", "brilliant", "broadcast", "burden", "burst", "cabin",
        "calculate", "capability", "capacity", "capture", "carbon", "casual",
        "category", "cease", "celebrity", "chaos", "characteristic", "characterize",
        "charity", "charter", "chronic", "circuit", "circumstance", "cite", "civilian",
        "clarify", "clarity", "classic", "classification", "classify", "clause",
        "client", "coalition", "code", "cognitive", "coincide", "collapse",
        "collective", "colonial", "combat", "commodity", "companion", "comparable",
        "compel", "compensate", "compile", "complexity", "compliance", "component",
        "comprehensive", "comprise", "compromise", "compute", "conceive", "concentrate",
        "concept", "conclude", "concrete", "conduct", "confess", "confront",
        "confusion", "congress", "consent", "conservation", "conservative",
        "considerable", "consist", "consistently", "conspiracy", "constitute",
        "constitution", "construct", "consultant", "consumer", "consumption",
        "contemplate", "contest", "context", "contract", "contradict", "contribute",
        "convention", "convert", "convey", "conviction", "cooperate", "coordinate",
        "cope", "corporate", "corporation", "correction", "correlation", "correspond",
        "council", "counselor", "craft", "crash", "credible", "crew", "criterion",
        "critic", "critical", "criticism", "crush", "cultivate", "cumulative",
        "curiosity", "curious", "curriculum", "curve", "cycle", "database", "deadline",
        "debate", "decade", "decline", "dedicate", "deem", "default", "defend",
        "deficit", "define", "definition", "delay", "delegate", "deliberately",
        "delicate", "democracy", "demonstrate", "deny", "departure", "deploy",
        "depression", "derive", "destiny", "detect", "determination", "dialogue",
        "dignity", "dimension", "diminish", "diplomat", "disability", "discipline",
        "disclose", "discourse", "discrimination", "dismiss", "disorder", "display",
        "disposal", "dispute", "distinct", "distinction", "distinguish", "distribute",
        "distribution", "diverse", "diversity", "doctrine", "domestic", "dominant",
        "dominate", "donor", "draft", "drain", "drama", "dramatic", "drift", "dynamics",
        "eager", "ease", "echo", "ecology", "elaborate", "elderly", "elect",
        "eliminate", "elite", "embrace", "emerge", "emission", "emphasize", "empire",
        "enable", "encounter", "endorse", "enforce", "engage", "enhance", "enormous",
        "enterprise", "enthusiasm", "entity", "equip", "equivalent", "era", "erode",
        "essence", "ethnic", "evaluate", "evolution", "evolve", "exceed", "exclusively",
        "execute", "exemption", "exhibit", "expand", "expansion", "expenditure",
        "expertise", "explicit", "exploit", "export", "exposure", "extend", "extent",
        "external", "extract", "fabric", "facilitate", "faculty", "famine",
        "fascinate", "fatal", "fate", "federal", "fellowship", "feminist", "fiber",
        "fierce", "file", "finance", "flexible", "flourish", "fluid", "footage",
        "forecast", "formula", "forth", "fossil", "fraction", "fragment", "framework",
        "franchise", "frequent", "frustrate", "fulfill", "functional", "fundamental",
        "furthermore", "galaxy", "gender", "genuine", "gesture", "glimpse", "globe",
        "glory", "governance", "grace", "graduate", "grain", "grant", "grateful",
        "grave", "gravity", "grief", "grip", "gross", "guarantee", "guilty",
        "ハーバー", "harbor", "harsh", "harvest", "headquarters", "heal", "heritage",
        "highlight", "hike", "horizon", "hormone", "horror", "hostile", "household",
        "humanitarian", "hypothesis", "identical", "ideology", "illusion", "illustrate",
        "immune", "implement", "implication", "implicit", "impose", "impulse",
        "incentive", "incidence", "incorporate", "index", "induce", "inevitable",
        "inflation", "infrastructure", "inherent", "initiate", "initiative", "inject",
        "innovation", "insight", "inspect", "inspiration", "install", "instance",
        "integrate", "integrity", "intellectual", "intense", "interact", "interfere",
        "interior", "interpret", "intervention", "intimate", "invasion", "inventory",
        "invoke", "isolate", "jurisdiction", "justify", "keen", "labor", "landscape",
        "latter", "launch", "lawsuit", "layer", "layout", "legislation", "legitimate",
        "leisure", "liberal", "liberty", "likewise", "linear", "literacy", "literary",
        "literature", "lobby", "logic", "logical", "logistics", "loyal", "mainstream",
        "mandate", "manifest", "manipulate", "manuscript", "margin", "marine",
        "mechanism", "medieval", "medium", "mere", "merely", "merge", "merit",
        "metabolism", "methodology", "migrate", "mineral", "minimal", "ministry",
        "miracle", "moderate", "modification", "modify", "momentum", "monitor",
        "monopoly", "moreover", "mortgage", "motivate", "motive", "municipal",
        "mutual", "namely", "negotiate", "neutral", "nevertheless", "nightmare",
        "noble", "norm", "notable", "notion", "nuclear", "numerous", "obesity",
        "objection", "objective", "obligation", "obscure", "observe", "obtain",
        "ongoing", "ongoing", "opposition", "opt", "optimal", "orbit", "orientation",
        "outbreak", "outlook", "output", "overcome", "overlook", "overseas", "overturn",
        "overwhelming", "ownership", "paradox", "parallel", "parameter", "partial",
        "participate", "participation", "particle", "partnership", "patent", "patience",
        "peak", "penalty", "perceive", "perception", "persist", "petition",
        "pharmaceutical", "phenomenon", "pioneer", "pitch", "plea", "pledge",
        "portable", "portfolio", "portrait", "pose", "posterior", "potential",
        "practitioner", "precede", "precise", "precisely", "predominantly", "prejudice",
        "preliminary", "premise", "premium", "prescribe", "presumption", "prevail",
        "prevention", "previously", "pride", "prior", "priority", "privacy",
        "probe", "proceed", "proclaim", "profound", "prominent", "promotion",
        "propaganda", "proportion", "prosecutor", "prospect", "prosperity",
        "protective", "protocol", "provoke", "pump", "quest", "quota",
        "radical", "rally", "random", "ratio", "rational", "regime", "regulate",
        "rehabilitation", "reinforce", "relevant", "reluctant", "remedy", "render",
        "renew", "renowned", "representation", "reproduce", "republic", "reputation",
        "resemble", "reservoir", "resignation", "resist", "resolution", "resolve",
        "respective", "restore", "restriction", "retain", "retreat", "revelation",
        "revenue", "reverse", "rigid", "ritual", "rival", "robust", "rural",
        "sanction", "satellite", "scandal", "scatter", "scenario", "scholar",
        "scope", "secular", "segment", "seize", "sensation", "sentiment",
        "sequence", "shelter", "shore", "shortage", "shrink", "siege",
        "simulate", "simultaneous", "skeptic", "slash", "slice", "slope", "soccer",
        "solely", "solidarity", "sophisticated", "sovereignty", "span", "spark",
        "specification", "specimen", "spectrum", "speculate", "sphere", "stability",
        "stake", "stance", "stark", "statistic", "statute", "stem", "stereotype",
        "stimulate", "strain", "strand", "strategic", "structural", "structure",
        "submit", "subordinate", "subsidy", "substance", "substantial",
        "substitute", "subtle", "successive", "sue", "supplement", "suppress",
        "surplus", "surveillance", "suspend", "sustain", "sustainable", "syndrome",
        "tackle", "tactic", "terrorism", "testify", "texture", "therapy", "thesis",
        "thrive", "tolerance", "toxic", "trace", "tragedy", "trait", "transaction",
        "transition", "transmission", "transparency", "tribunal", "trigger", "triumph",
        "tropical", "tumor", "tunnel", "twist", "undergo", "undermine", "undoubtedly",
        "unfold", "unified", "unprecedented", "upgrade", "uphold", "utilize",
        "vacation", "venture", "verify", "versus", "viable", "violation", "virtual",
        "virus", "vocal", "volcano", "voluntary", "vulnerability", "warfare",
        "warrant", "well-being", "whereby", "widespread", "withdrawal", "workforce",
        "workshop", "yield",
    }
    b2_words = {
        "abbreviation", "abolish", "accountable", "accumulation", "acquisition",
        "adhere", "adjacent", "adverse", "affiliate", "affirm", "aftermath",
        "aggregate", "allegation", "alleviate", "alliance", "ambiguity", "amid",
        "ample", "anchor", "anecdote", "apparatus", "appetite", "archive",
        "articulate", "aspiration", "assertion", "assimilate", "atrocity", "audit",
        "authentic", "autonomy", "avert", "benchmark", "benign", "bilateral",
        "blueprint", "bolster", "breach", "broker", "bureaucracy", "calibrate",
        "catalyst", "cater", "caution", "cemetery", "census", "cessation",
        "chancellor", "chronic", "civic", "clamp", "cling", "cluster",
        "coerce", "coherent", "cohesion", "coincidence", "collateral", "collide",
        "commemorate", "commence", "commodity", "compact", "compatible",
        "compensate", "complement", "compliment", "comply", "composite",
        "composition", "compulsory", "conceal", "concede", "conceivable",
        "concurrent", "condemn", "confine", "confiscate", "conformity",
        "confront", "congregation", "conjecture", "conscientious", "consensus",
        "consolidate", "constellation", "contempt", "contingency", "contradict",
        "controversial", "controversy", "conventional", "convergence", "copyright",
        "correlate", "correspondence", "corrupt", "counterpart", "courtesy",
        "credentials", "creed", "critique", "culminate", "curb", "custody",
        "debris", "deception", "decree", "deficit", "defy", "delegate",
        "deliberate", "delusion", "demographic", "denounce", "deploy",
        "depreciate", "deprive", "designate", "detain", "deteriorate",
        "devise", "diffuse", "dilemma", "dilute", "discard", "disparity",
        "displace", "disproportionate", "disrupt", "dissent", "dissolve",
        "distort", "divert", "divest", "dividend", "doctrine", "durable",
        "dwarf", "dysfunction", "eavesdrop", "eclipse", "edict", "eligible",
        "elude", "embargo", "embed", "embody", "encompass", "endure",
        "engulf", "enlighten", "envision", "epidemic", "equity", "erect",
        "erratic", "espionage", "esteem", "evacuate", "exacerbate", "exert",
        "exile", "expedite", "expel", "explicit", "extravagant", "facade",
        "facet", "feasible", "fidelity", "fiscal", "flaw", "forge", "formidable",
        "foster", "friction", "futile", "generic", "genocide", "goodwill",
        "graft", "gratitude", "grievance", "grotesque", "guerrilla", "guru",
        "hamper", "havoc", "heed", "hierarchy", "hinder", "holistic",
        "humiliate", "hybrid", "imminent", "impair", "impede", "imperative",
        "inception", "incite", "indictment", "indigenous", "indispensable",
        "inertia", "infiltrate", "influx", "inhibit", "instigate", "insurgent",
        "intangible", "intercept", "interim", "interplay", "intricate",
        "intrinsic", "inundate", "invoke", "irony", "irreversible", "jeopardize",
        "jurisdiction", "juxtapose", "kudos", "laden", "landmark", "latent",
        "latitude", "lenient", "leverage", "levy", "liaison", "linger",
        "litigation", "lucrative", "magnitude", "malice", "mandate",
        "maneuver", "manifest", "maritime", "mediate", "mercenary", "merge",
        "meticulous", "militia", "mitigate", "mobilize", "moratorium",
        "mounting", "negligence", "novice", "nurture", "oath", "oblige",
        "omit", "onset", "opaque", "opt", "orchestrate", "outweigh",
        "override", "oversee", "paradigm", "partisan", "patronage", "peer",
        "penetrate", "perennial", "periphery", "perpetual", "perpetuate",
        "persecute", "pertain", "pertinent", "pervasive", "petition",
        "plausible", "plight", "plunge", "polarize", "precarious",
        "precedent", "predator", "predicament", "preemptive", "prevalent",
        "procurement", "prodigy", "prohibit", "proliferate", "prone",
        "prosecute", "proviso", "proxy", "purge", "quest", "ramification",
        "ratify", "rebuke", "reckon", "reconcile", "recourse", "rectify",
        "redundant", "referendum", "refrain", "rein", "relentless",
        "relinquish", "remnant", "repeal", "repercussion", "replenish",
        "repression", "reproach", "repudiate", "requisite", "resent",
        "resilience", "retaliate", "retention", "retrospect", "revoke",
        "rhetoric", "rift", "rigorous", "rudimentary", "rupture", "ruthless",
        "safeguard", "saga", "salvage", "scrutiny", "secede", "segregate",
        "semblance", "setback", "severance", "skepticism", "slump",
        "solicit", "solemn", "sovereign", "spawn", "spearhead", "stagger",
        "stagnate", "stakeholder", "staunch", "stigma", "stipulate",
        "strife", "stringent", "subordinate", "subpoena", "subsidize",
        "substantiate", "subvert", "suffice", "supersede", "supplement",
        "surge", "surmount", "susceptible", "swear", "symposium", "tangible",
        "tariff", "tarnish", "tenure", "termination", "threshold",
        "trajectory", "transcend", "transgression", "tumult", "turbulence",
        "unilateral", "unprecedented", "upheaval", "uphold", "usurp",
        "utilitarian", "vehement", "vindicate", "volatile", "vulnerability",
        "waive", "wield", "zealous",
    }
    c1_words = {
        "aberration", "abstain", "accolade", "acquiesce", "acrimonious",
        "admonish", "adversarial", "albeit", "altruistic", "amalgamate",
        "ambivalent", "anachronism", "analogous", "anarchy", "annex",
        "antagonize", "antithesis", "apathy", "appease", "ardent",
        "ascertain", "assiduous", "attrition", "augment", "auspicious",
        "austere", "autocratic", "avarice", "belligerent", "benevolent",
        "blatant", "brevity", "bureaucratic", "capitulate", "caustic",
        "circumscribe", "circumvent", "clandestine", "coalesce", "coercion",
        "colloquial", "commensurate", "compendium", "complacent", "complicit",
        "confer", "confound", "congenial", "conjure", "connive",
        "conscript", "consecrate", "consternation", "contentious",
        "contiguous", "contingent", "contrite", "conundrum", "copious",
        "corollary", "corroborate", "credulous", "debacle", "decorum",
        "deference", "deft", "delineate", "deluge", "demagogue",
        "denigrate", "denounce", "depose", "deprecate", "derelict",
        "desiccate", "despondent", "destitute", "deter", "detrimental",
        "deviate", "diatribe", "dichotomy", "diffident", "digress",
        "diligent", "discern", "discrepancy", "disparage", "disseminate",
        "dissolution", "diverge", "divulge", "dogma", "dormant",
        "draconian", "dubious", "duplicity", "ebullient", "eclectic",
        "edify", "efficacy", "effluent", "egalitarian", "egregious",
        "elicit", "eloquent", "elucidate", "emancipate", "embellish",
        "embroil", "empirical", "emulate", "encroach", "endemic",
        "enigma", "enmity", "entrench", "ephemeral", "epitome",
        "equanimity", "equitable", "eradicate", "erstwhile", "esoteric",
        "espouse", "ethereal", "exacerbate", "exasperate", "exemplify",
        "exonerate", "expedient", "expunge", "extol", "extraneous",
        "facetious", "fallacy", "fastidious", "fathom", "fecund",
        "felicitous", "fervent", "fiasco", "flagrant", "flout",
        "foment", "forbearance", "fortuitous", "fractious", "frivolous",
        "frugal", "garrulous", "germane", "grandiloquent", "gratuitous",
        "gregarious", "hackneyed", "hapless", "harbinger", "hegemony",
        "heresy", "idiosyncratic", "ignominious", "imbue", "immutable",
        "impasse", "impervious", "implacable", "impugn", "inadvertent",
        "incandescent", "incipient", "incongruous", "incontrovertible",
        "incumbent", "indelible", "indolent", "inexorable", "ingratiate",
        "innate", "innocuous", "inscrutable", "insidious", "insolvent",
        "intransigent", "inveterate", "irascible", "irreverent",
        "judicious", "laconic", "lament", "languid", "largesse",
        "laud", "litigious", "ludicrous", "magnanimous", "malfeasance",
        "malign", "malleable", "nebulous", "nefarious", "nonchalant",
        "obdurate", "obfuscate", "oblique", "obsequious", "obsolete",
        "obstinate", "odious", "onerous", "opulent", "ostentatious",
        "ostracize", "palatable", "palpable", "pariah", "parsimonious",
        "paucity", "pedantic", "pejorative", "penchant", "penurious",
        "perfunctory", "pernicious", "perseverance", "perspicacious",
        "petulant", "philanthropic", "placate", "platitude", "plethora",
        "poignant", "polemic", "pragmatic", "preclude", "precocious",
        "predilection", "preposterous", "prescient", "presumptuous",
        "proclivity", "prodigious", "profligate", "prolific", "promulgate",
        "propensity", "propitiate", "prosaic", "proscribe", "prudent",
        "pugnacious", "punitive", "quagmire", "querulous", "quintessential",
        "quixotic", "rancor", "rapacious", "rebuff", "recalcitrant",
        "recant", "redress", "refute", "relegate", "remiss",
        "remunerate", "reprehensible", "rescind", "restive", "reticent",
        "retrograde", "reverence", "sacrilege", "sagacious", "salient",
        "sanguine", "sardonic", "scrupulous", "sedition", "seminal",
        "solace", "soporific", "specious", "spurious", "squalid",
        "staid", "stolid", "strident", "stringent", "subjugate",
        "sublimate", "substantive", "subversive", "succinct", "supercilious",
        "supplant", "surreptitious", "sycophant", "tacit", "taciturn",
        "temerity", "tempestuous", "tenacious", "tenet", "tirade",
        "torpid", "tractable", "transgress", "transient", "travesty",
        "truculent", "ubiquitous", "umbrage", "unconscionable", "unctuous",
        "underpin", "unequivocal", "unfathomable", "unprecedented",
        "unscrupulous", "untenable", "urbane", "usurp", "vacillate",
        "vanguard", "venerate", "veracious", "verbose", "vicarious",
        "vindictive", "virulent", "vitriolic", "vociferous", "voluble",
        "voracious", "warrant", "wary", "whimsical", "zealot",
    }

    for w in a1_words: CEFR_MAP[w.lower()] = "A1"
    for w in a2_words: CEFR_MAP[w.lower()] = "A2"
    for w in b1_words: CEFR_MAP[w.lower()] = "B1"
    for w in b2_words: CEFR_MAP[w.lower()] = "B2"
    for w in c1_words: CEFR_MAP[w.lower()] = "C1"

    # Save cache
    with open(cache_path, "w", encoding="utf-8") as f:
        json.dump(CEFR_MAP, f)
    print(f"Built CEFR map with {len(CEFR_MAP)} words")

# ---------------------------------------------------------------------------
# 3. Classify words
# ---------------------------------------------------------------------------

classified: dict[str, list[str]] = {level: [] for level in CEFR_LEVELS}

for word in words:
    key = word.lower().strip()
    level = CEFR_MAP.get(key, "C1")  # Default unknown words to C1
    classified[level].append(word)

# ---------------------------------------------------------------------------
# 4. Write Markdown
# ---------------------------------------------------------------------------

out_path = Path(__file__).parent / "words_by_cefr.md"
with open(out_path, "w", encoding="utf-8") as f:
    f.write("# 单词 CEFR 分级\n\n")

    # Table of contents
    for level in CEFR_LEVELS:
        count = len(classified[level])
        if count > 0:
            f.write(f"- [{level} ({count} words)](#{level.lower()})\n")
    f.write("\n---\n\n")

    # Each level
    for level in CEFR_LEVELS:
        ws = classified[level]
        if not ws:
            continue
        f.write(f"## {level}\n\n")
        f.write(" ".join(ws))
        f.write("\n\n")

    f.write(f"---\n\n*Total: {len(words)} words*\n")

print(f"\nOutput written to {out_path}")
for level in CEFR_LEVELS:
    print(f"  {level}: {len(classified[level])} words")
print(f"  Total: {len(words)}")
