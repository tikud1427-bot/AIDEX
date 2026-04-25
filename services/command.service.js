const commands = {
  CREATE_BUNDLE: "create_bundle",
  RUN_BUNDLE: "run_bundle",
  DELETE_BUNDLE: "delete_bundle",
};

function executeCommand(command, payload) {
  switch (command) {
    case commands.CREATE_BUNDLE:
      return { action: "redirect", to: "/bundles" };

    case commands.RUN_BUNDLE:
      return { action: "api", endpoint: `/bundle/${payload.id}/run` };

    case commands.DELETE_BUNDLE:
      return { action: "api", endpoint: `/bundle/${payload.id}`, method: "DELETE" };

    default:
      return null;
  }
}

module.exports = { commands, executeCommand };