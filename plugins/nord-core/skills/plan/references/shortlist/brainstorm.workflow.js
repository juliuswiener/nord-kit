export const meta = {
  name: 'adversarial-brainstorm',
  description: 'Dialectic idea engine: persona ideators diverge, red-team critics try to kill each idea, champions steelman survivors, synthesis ranks a decision-ready shortlist',
  whenToUse: 'Open-ended "how could we build/design/approach X" questions where you want diverse ideas pressure-tested before committing, not a single first-draft answer',
  phases: [
    { title: 'Frame' },
    { title: 'Diverge' },
    { title: 'Attack' },
    { title: 'Defend' },
    { title: 'Synthesize' },
  ],
}

// ---------- ideation lenses ----------
const PERSONAS = [
  { name: 'first-principles', brief: 'Strip the problem to physical/economic fundamentals and rebuild a solution from scratch, ignoring how it is "normally" done.' },
  { name: 'contrarian', brief: 'Invert the obvious assumption. Propose the deliberate opposite of the default approach and show why it might be better.' },
  { name: 'cross-domain', brief: 'Steal a proven mechanism from an unrelated field (biology, games, logistics, finance, aviation) and transplant it here.' },
  { name: 'user-empath', brief: 'Start from the sharpest user pain and the real job-to-be-done. Propose what would make the user feel relief, not what is technically neat.' },
  { name: 'minimalist', brief: 'Find the smallest thing that delivers most of the value. Subtract features, steps, and surfaces until only the essential remains.' },
  { name: 'futurist', brief: 'Assume 3-5 years of capability ahead. Propose what becomes possible/cheap soon and how to position for it now.' },
  { name: 'provocateur', brief: 'Propose deliberately wild or "bad" ideas at the edge of the space — then mine each for the salvageable kernel worth keeping.' },
  { name: 'systems-thinker', brief: 'Optimize the whole loop, not the part. Find leverage points, feedback loops, and second-order effects others miss.' },
]

// ---------- critique lenses (red team) ----------
const CRITICS = [
  { lens: 'feasibility', brief: 'Can this actually be built with sane effort given the stated constraints? Attack tech reality, hidden complexity, unproven dependencies. Default to kill if it needs a miracle.' },
  { lens: 'desirability', brief: 'Does anyone genuinely want this? Attack the value proposition. Is the pain real and acute, or imagined? Would the user actually change behaviour? Default to kill if value is speculative.' },
  { lens: 'risk', brief: 'What are the failure modes, hidden costs, maintenance burden, and harmful second-order effects? Attack the downside. Default to kill if a plausible failure is severe and likely.' },
  { lens: 'novelty', brief: 'Does this already exist, or is it done better elsewhere? Attack on prior art and differentiation. Default to kill if it is a worse copy of something that exists.' },
]

// ---------- config (args override, budget scales) ----------
const topic =
  typeof args === 'string'
    ? args
    : (args && (args.topic || args.question || args.prompt)) || null
if (!topic) throw new Error('adversarial-brainstorm: args.topic (or a string arg) is required')

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, Math.floor(n)))
}
function scaleByBudget(base) {
  if (!budget.total) return base
  return Math.max(base, Math.min(PERSONAS.length, Math.floor(budget.total / 120_000) + 4))
}

const cfg = (typeof args === 'object' && args) || {}
const N_PERSONAS = clamp(cfg.personas ?? scaleByBudget(6), 2, PERSONAS.length)
const IDEAS_EACH = clamp(cfg.ideasEach ?? 3, 1, 6)
const N_CRITICS = clamp(cfg.critics ?? 3, 1, CRITICS.length)
const KILL_THRESHOLD = cfg.killThreshold ?? Math.ceil((N_CRITICS + 1) / 2) // simple majority
const constraints = cfg.constraints || null // optional caller-supplied hard constraints

// ---------- schemas ----------
const FRAME_SCHEMA = {
  type: 'object',
  required: ['restated_problem', 'success_criteria', 'constraints', 'non_goals'],
  properties: {
    restated_problem: { type: 'string', description: 'One sharp sentence: what are we actually trying to solve' },
    why_it_matters: { type: 'string' },
    success_criteria: { type: 'array', items: { type: 'string' }, description: 'How we would know an idea is good' },
    constraints: { type: 'array', items: { type: 'string' }, description: 'Hard boundaries ideas must respect' },
    non_goals: { type: 'array', items: { type: 'string' } },
    key_unknowns: { type: 'array', items: { type: 'string' } },
  },
}
const IDEAS_SCHEMA = {
  type: 'object',
  required: ['ideas'],
  properties: {
    ideas: {
      type: 'array',
      items: {
        type: 'object',
        required: ['title', 'pitch'],
        properties: {
          title: { type: 'string', description: 'Short distinctive name' },
          pitch: { type: 'string', description: '2-4 sentences: what it is and why it could work' },
          mechanism: { type: 'string', description: 'How it actually works / the core trick' },
        },
      },
    },
  },
}
const VERDICT_SCHEMA = {
  type: 'object',
  required: ['kill', 'reason', 'severity'],
  properties: {
    kill: { type: 'boolean', description: 'true = this idea should be dropped on this lens' },
    reason: { type: 'string', description: 'The single strongest objection, concrete' },
    severity: { type: 'string', enum: ['low', 'medium', 'high'] },
    salvage: { type: 'string', description: 'If killable, what minimal change would save it (optional)' },
  },
}
const DEFENSE_SCHEMA = {
  type: 'object',
  required: ['strengthened_pitch', 'rebuttal'],
  properties: {
    strengthened_pitch: { type: 'string', description: 'The idea, sharpened to its strongest honest form' },
    rebuttal: { type: 'string', description: 'Direct answer to the strongest surviving objection' },
    first_test: { type: 'string', description: 'Cheapest experiment that would prove or kill it' },
  },
}
const SYNTH_SCHEMA = {
  type: 'object',
  required: ['shortlist', 'recommendation'],
  properties: {
    shortlist: {
      type: 'array',
      items: {
        type: 'object',
        required: ['title', 'why', 'effort', 'risk', 'score'],
        properties: {
          title: { type: 'string' },
          why: { type: 'string', description: 'Why it earns a place on the shortlist' },
          effort: { type: 'string', enum: ['S', 'M', 'L', 'XL'] },
          risk: { type: 'string', enum: ['low', 'medium', 'high'] },
          score: { type: 'number', description: '0-100 overall promise' },
          first_test: { type: 'string' },
        },
      },
    },
    hybrids: {
      type: 'array',
      items: {
        type: 'object',
        required: ['title', 'combines', 'pitch'],
        properties: {
          title: { type: 'string' },
          combines: { type: 'array', items: { type: 'string' }, description: 'Titles of the ideas fused' },
          pitch: { type: 'string' },
        },
      },
    },
    recommendation: { type: 'string', description: 'What you would do first and why' },
    open_questions: { type: 'array', items: { type: 'string' } },
  },
}

// ---------- helpers ----------
const frameJson = (f) => JSON.stringify(f).slice(0, 6000)
function ideaKey(i) {
  return String(i.title || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

// ========================= PHASE 1: FRAME =========================
phase('Frame')
const frame = await agent(
  `You are framing a brainstorming problem before a multi-agent ideation panel runs.\n` +
    `Topic: ${topic}\n` +
    (constraints ? `Caller-supplied hard constraints: ${JSON.stringify(constraints)}\n` : '') +
    `Restate the real problem in one sharp sentence, then list success criteria, hard constraints, non-goals, and key unknowns. ` +
    `Be concrete and opinionated; a vague frame produces vague ideas. Do not propose solutions yet.`,
  { label: 'frame', phase: 'Frame', schema: FRAME_SCHEMA },
)
log(`Framed: "${frame.restated_problem}"`)

// ========================= PHASE 2: DIVERGE =========================
phase('Diverge')
const chosen = PERSONAS.slice(0, N_PERSONAS)
const ideaBatches = await parallel(
  chosen.map((p) => () =>
    agent(
      `You are the "${p.name}" ideator on a brainstorming panel.\n` +
        `Your lens: ${p.brief}\n\n` +
        `Problem frame (JSON): ${frameJson(frame)}\n\n` +
        `Produce ${IDEAS_EACH} distinct ideas that fit YOUR lens and respect the constraints. ` +
        `Each idea: a distinctive title, a 2-4 sentence pitch, and the core mechanism. ` +
        `Be bold and specific — overlap with conventional approaches is wasted output. No hedging, no lists of generic best practices.`,
      { label: `ideate:${p.name}`, phase: 'Diverge', schema: IDEAS_SCHEMA },
    ).then((r) => (r.ideas || []).map((i) => ({ ...i, persona: p.name }))),
  ),
)
// flatten + dedup by normalized title
const seen = new Set()
const ideas = []
for (const idea of ideaBatches.filter(Boolean).flat()) {
  const k = ideaKey(idea)
  if (!k || seen.has(k)) continue
  seen.add(k)
  ideas.push(idea)
}
log(`${ideas.length} distinct ideas from ${chosen.length} personas`)

// ============= PHASE 3+4: ATTACK then DEFEND (pipeline, per idea) =============
phase('Attack')
const critics = CRITICS.slice(0, N_CRITICS)
const judged = await pipeline(
  ideas,
  // stage 1: red-team panel attacks this idea
  (idea) =>
    parallel(
      critics.map((c) => () =>
        agent(
          `You are a RED-TEAM critic on the "${c.lens}" lens. Your job is to KILL weak ideas, not to be kind.\n` +
            `Lens: ${c.brief}\n\n` +
            `Problem frame (JSON): ${frameJson(frame)}\n` +
            `Idea: ${JSON.stringify({ title: idea.title, pitch: idea.pitch, mechanism: idea.mechanism })}\n\n` +
            `Attack it on your lens only. Decide kill=true/false, give the single strongest concrete objection, rate severity, ` +
            `and optionally note the minimal change that would salvage it. Be skeptical; default to kill when genuinely unconvinced.`,
          { label: `attack:${c.lens}`, phase: 'Attack', model: 'sonnet', schema: VERDICT_SCHEMA },
        ).then((v) => ({ ...v, lens: c.lens })),
      ),
    ).then((votes) => {
      const v = votes.filter(Boolean)
      const kills = v.filter((x) => x.kill).length
      return { idea, votes: v, kills, survived: kills < KILL_THRESHOLD }
    }),
  // stage 2: champion steelmans survivors only
  (res, idea, i) => {
    if (!res || !res.survived) return res // dropped ideas pass through untouched
    const objections = res.votes
      .filter((x) => x.kill || x.severity !== 'low')
      .map((x) => `[${x.lens}] ${x.reason}`)
      .join(' | ')
    return agent(
      `You are the CHAMPION for an idea that survived adversarial review. Make it as strong as it honestly can be.\n` +
        `Problem frame (JSON): ${frameJson(frame)}\n` +
        `Idea: ${JSON.stringify({ title: res.idea.title, pitch: res.idea.pitch, mechanism: res.idea.mechanism })}\n` +
        `Surviving objections to answer: ${objections || '(none significant)'}\n\n` +
        `Sharpen the pitch to its strongest honest form, directly rebut the strongest objection, and give the cheapest first test that would prove or kill it. Do not overclaim.`,
      { label: `defend:${(res.idea.title || 'idea').slice(0, 24)}`, phase: 'Defend', schema: DEFENSE_SCHEMA },
    ).then((d) => ({ ...res, defense: d }))
  },
)

const survivors = judged.filter((r) => r && r.survived)
const dropped = judged.filter((r) => r && !r.survived)
log(`${survivors.length} survived, ${dropped.length} killed by the red team`)

if (survivors.length === 0) {
  return {
    topic,
    frame,
    survivors: [],
    dropped: dropped.map((d) => ({ title: d.idea.title, kills: d.kills, objections: d.votes.map((v) => v.reason) })),
    note: 'Every idea was killed in adversarial review. Loosen constraints, raise killThreshold, or reframe the problem.',
  }
}

// ========================= PHASE 5: SYNTHESIZE =========================
phase('Synthesize')
const survivorPayload = survivors.map((s) => ({
  title: s.idea.title,
  persona: s.idea.persona,
  pitch: s.defense?.strengthened_pitch || s.idea.pitch,
  mechanism: s.idea.mechanism,
  rebuttal: s.defense?.rebuttal,
  first_test: s.defense?.first_test,
  kills: s.kills,
}))
const synthesis = await agent(
  `You are the synthesis lead closing an adversarial brainstorm. ${survivors.length} ideas survived red-team review.\n` +
    `Problem frame (JSON): ${frameJson(frame)}\n` +
    `Surviving ideas (JSON): ${JSON.stringify(survivorPayload).slice(0, 12000)}\n\n` +
    `Do four things: (1) rank the strongest into a shortlist with effort, risk, a 0-100 promise score, and a first test; ` +
    `(2) propose 1-3 HYBRIDS that fuse complementary survivors into something stronger than either; ` +
    `(3) give one clear recommendation of what to do first and why; (4) list the open questions that most affect the choice. ` +
    `Be decisive — the user wants a path, not a catalogue.`,
  { label: 'synthesize', phase: 'Synthesize', schema: SYNTH_SCHEMA },
)

return {
  topic,
  frame,
  counts: { ideas: ideas.length, survived: survivors.length, dropped: dropped.length, personas: chosen.length, critics: critics.length, killThreshold: KILL_THRESHOLD },
  shortlist: synthesis.shortlist,
  hybrids: synthesis.hybrids || [],
  recommendation: synthesis.recommendation,
  open_questions: synthesis.open_questions || [],
  survivors: survivorPayload,
  dropped: dropped.map((d) => ({ title: d.idea.title, persona: d.idea.persona, kills: d.kills, objections: d.votes.filter((v) => v.kill).map((v) => `[${v.lens}] ${v.reason}`) })),
}
