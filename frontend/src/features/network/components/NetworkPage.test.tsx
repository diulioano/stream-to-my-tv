import { screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { network } from "../../../test/fixtures";
import { renderApp } from "../../../test/render";
import { API, backend, server } from "../../../test/server";

describe("NetworkPage", () => {
  it("shows the LAN interface, RFC 1918 badge and panel/receiver URLs", async () => {
    renderApp("/rede");
    expect(await screen.findByText("Interface Wi-Fi · 192.168.1.20")).toBeInTheDocument();
    expect(screen.getByText("RFC 1918 · 192.168.1.0/24")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "http://192.168.1.20:4321/" })).toHaveAttribute("href", "http://192.168.1.20:4321/");
    expect(screen.getByRole("link", { name: "http://192.168.1.20:4321/receiver" })).toBeInTheDocument();
  });

  it("toggles QR error correction between M and Q", async () => {
    const { user } = renderApp("/rede");
    const qr = await screen.findByRole("img", { name: "QR Code para http://192.168.1.20:4321/" });
    expect(qr).toHaveAttribute("src", `${API}/api/network/qr.svg?ecc=M`);
    expect(screen.getByRole("tab", { name: "ECC M (15%)" })).toHaveAttribute("aria-selected", "true");

    await user.click(screen.getByRole("tab", { name: "ECC Q (25%)" }));
    expect(qr).toHaveAttribute("src", `${API}/api/network/qr.svg?ecc=Q`);

    await user.keyboard("{ArrowRight}");
    expect(qr).toHaveAttribute("src", `${API}/api/network/qr.svg?ecc=M`);
    expect(screen.getByRole("tab", { name: "ECC M (15%)" })).toHaveFocus();
    await user.keyboard("{ArrowLeft}");
    expect(screen.getByRole("tab", { name: "ECC Q (25%)" })).toHaveAttribute("aria-selected", "true");
  });

  it("flags an interface outside private address space", async () => {
    backend.network = { ...network, lan: { ...network.lan, cidr: "100.64.0.0/10" } };
    renderApp("/rede");
    expect(await screen.findByText("Fora da RFC 1918 · 100.64.0.0/10")).toBeInTheDocument();
  });

  it("reports a network endpoint failure", async () => {
    server.use(http.get(`${API}/api/network`, () => HttpResponse.json({ error: "Forbidden: invalid Host header" }, { status: 403 })));
    renderApp("/rede");
    expect(await screen.findByRole("alert")).toHaveTextContent("Forbidden: invalid Host header");
  });
});
