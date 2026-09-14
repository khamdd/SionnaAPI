import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { SinrApiPage, ThroughputApiPage } from "./ApiPages";

const scene = {
  id: "scene-1",
  name: "Test scene",
  bounds: { south: 1, west: 2, north: 3, east: 4 },
};

describe("api pages smoke render", () => {
  it("renders SINR page", () => {
    const html = renderToString(
      <SinrApiPage activeScene={scene} />,
    );
    expect(html).toContain("SINR API");
  });

  it("renders Throughput page", () => {
    const html = renderToString(
      <ThroughputApiPage activeScene={scene} />,
    );
    expect(html).toContain("Throughput API");
  });
});
