/* eslint-disable @typescript-eslint/no-require-imports */
const Module = require("module");
const original = Module.prototype.require;
Module.prototype.require = function mockServerOnly(id) {
  if (id === "server-only") return {};
  return original.apply(this, arguments);
};
