import { expect, it } from "vitest";
import { consumeSaxoOauthReturnMarker, isSaxoOauthReturn, shouldScheduleSaxoOauthReturnFocus } from "./saxoOauthReturn";

it("recognizes only the explicit one-shot Saxo OAuth return marker", () => {
  expect(isSaxoOauthReturn("?saxoConnected=1")).toBe(true);
  expect(isSaxoOauthReturn("?saxoConnected=0")).toBe(false);
  expect(isSaxoOauthReturn("?connected=1")).toBe(false);
});

it("consumes only the OAuth return marker while retaining route, query, and hash", () => {
  expect(
    consumeSaxoOauthReturnMarker({
      pathname: "/portfolio",
      search: "?source=manual&saxoConnected=1&view=positions",
      hash: "#saxo-api-details",
    }),
  ).toBe("/portfolio?source=manual&view=positions#saxo-api-details");
});

it("does not manufacture a query delimiter when the marker was the only query", () => {
  expect(consumeSaxoOauthReturnMarker({ pathname: "/", search: "?saxoConnected=1", hash: "" })).toBe("/");
});

it("schedules a return focus once even if StrictMode re-renders the effect", () => {
  expect(shouldScheduleSaxoOauthReturnFocus(true, "idle")).toBe(true);
  expect(shouldScheduleSaxoOauthReturnFocus(true, "scheduled")).toBe(false);
  expect(shouldScheduleSaxoOauthReturnFocus(true, "consumed")).toBe(false);
  expect(shouldScheduleSaxoOauthReturnFocus(false, "idle")).toBe(false);
});
