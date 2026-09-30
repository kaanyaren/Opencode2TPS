// Server-side entry. This plugin is TUI-only, so the server stub is inert.
// Deliberately no SDK import: the package ships with an empty install tree
// (the host provides TUI modules at runtime), so any bare import here would
// fail to resolve on npm installs.
export default {
  id: "opencode2tps",
  setup() {},
};
