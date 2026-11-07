// workflow-harness.cjs — the Workflow tool's globals as plain JS, so a test can run a Workflow script
// (audit.workflow.js, the script block of diff-deep.md) against a stub agent() with no model call.
// Used by anker-abgleich.test.cjs and audit-abdeckung.test.cjs.
//
// runScript(src, args, agent) -> { out, logs }   out = what the script returns, logs = its log() lines
//
// ponytail: pipeline()/parallel() are our reading of the Workflow reference ("a stage that throws drops that item to
// null"), not the runtime. Only a live Workflow run proves it. Upgrade path: one recorded live run as a fixture.

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const nullOnThrow = async (f) => { try { return await f(); } catch { return null; } };

async function runScript(src, args, agent) {
  const body = src.replace(/^export const meta/m, "const meta");
  const pipeline = (items, ...stages) => Promise.all(items.map((item, i) => nullOnThrow(async () => {
    let v = item;
    for (const s of stages) v = await s(v, item, i);
    return v;
  })));
  const parallel = (thunks) => Promise.all(thunks.map((t) => nullOnThrow(t)));
  const logs = [];
  const budget = { total: null, spent: () => 0, remaining: () => Infinity };
  const workflow = async () => { throw new Error("workflow() is not stubbed"); };
  const out = await new AsyncFunction("args", "agent", "pipeline", "parallel", "phase", "log", "budget", "workflow", body)(
    args, agent, pipeline, parallel, () => {}, (m) => logs.push(String(m)), budget, workflow);
  return { out, logs };
}

module.exports = { runScript };
