import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { VALUZ_BASE_CATALOG_ID } from "../catalog";
import { A2UIRenderer } from "./renderer";

const line = (message: unknown) => JSON.stringify(message);
const DOC = [
  line({ version: "v0.9.1", createSurface: { surfaceId: "s1", catalogId: VALUZ_BASE_CATALOG_ID } }),
  line({
    version: "v0.9.1",
    updateComponents: {
      surfaceId: "s1",
      components: [
        { id: "root", component: "Stack", children: ["title", "go"] },
        { id: "title", component: "TextContent", text: "Actions", variant: "h2" },
        { id: "go", component: "Button", label: "Refresh", action: { event: { name: "refresh", context: { range: "7d" } } } },
      ],
    },
  }),
].join("\n");

describe("A2UIRenderer actions", () => {
  it("dispatches surface actions to onAction with the A2UI client action", () => {
    const onAction = vi.fn();
    render(<A2UIRenderer body={DOC} status="success" onAction={onAction} />);
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onAction).toHaveBeenCalledWith(
      expect.objectContaining({ name: "refresh", surfaceId: "s1", sourceComponentId: "go" }),
    );
  });

  it("keeps dispatching to the latest handler without rebuilding the surface", () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = render(<A2UIRenderer body={DOC} status="success" onAction={first} />);
    rerender(<A2UIRenderer body={DOC} status="success" onAction={second} />);
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("renders read-only when no handler is given", () => {
    render(<A2UIRenderer body={DOC} status="success" />);
    expect(() => fireEvent.click(screen.getByRole("button", { name: "Refresh" }))).not.toThrow();
  });
});
