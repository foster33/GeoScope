/**
 * Node `--import` preload that swaps the global fetch for the fake upstream
 * router before the server's modules load. Used to run the real server against
 * fixtures for the browser E2E suite:
 *
 *   node --import ./fixtures/preload.js server.js
 */
import { installFakeUpstream } from "./upstream.js";

installFakeUpstream({ log: process.env.FAKE_UPSTREAM_LOG === "1" });
