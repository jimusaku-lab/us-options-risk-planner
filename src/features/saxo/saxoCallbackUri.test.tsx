import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { deriveSaxoPortalRegistrationUri, SaxoCallbackUriSetup } from "./saxoCallbackUri";

const runtimeCallback = "http://localhost:18787/api/saxo/auth/callback";
const portalRegistration = "http://localhost/api/saxo/auth/callback";

it("derives a no-port Saxo Portal registration URL while preserving the runtime callback path", () => {
  expect(deriveSaxoPortalRegistrationUri(runtimeCallback)).toBe(portalRegistration);
});

it("shows both callback forms and copies only the explicit Portal registration URL", () => {
  const onCopyPortalRegistrationUri = vi.fn();
  render(<SaxoCallbackUriSetup runtimeCallbackUri={runtimeCallback} onCopyPortalRegistrationUri={onCopyPortalRegistrationUri} />);

  expect(screen.getByText(portalRegistration)).toBeInTheDocument();
  expect(screen.getByText(runtimeCallback)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Portal登録用URLをコピー" }));
  expect(onCopyPortalRegistrationUri).toHaveBeenCalledWith(portalRegistration);
});

it("rejects non-loopback, non-http, or decorated runtime callback URLs", () => {
  expect(deriveSaxoPortalRegistrationUri("https://localhost:18787/api/saxo/auth/callback")).toBeNull();
  expect(deriveSaxoPortalRegistrationUri("http://example.test:18787/api/saxo/auth/callback")).toBeNull();
  expect(deriveSaxoPortalRegistrationUri(`${runtimeCallback}?code=secret`)).toBeNull();
});
