const Bundle = require("../models/Bundle");

async function runBundle(bundleId, generateAI) {
  const bundle = await Bundle.findById(bundleId);
  if (!bundle) throw new Error("Bundle not found");

  for (let step of bundle.steps) {
    if (bundle.progress[step.step]?.status === "done") continue;

    bundle.progress[step.step].status = "running";
    await bundle.save();

    try {
      const output = await generateAI([
        { role: "system", content: step.description }
      ]);

      bundle.progress[step.step] = {
        step: step.step,
        status: "done",
        output
      };

    } catch (err) {
      bundle.progress[step.step].status = "failed";
    }

    await bundle.save();
  }

  bundle.status = "completed";
  await bundle.save();

  return bundle;
}

module.exports = { runBundle };