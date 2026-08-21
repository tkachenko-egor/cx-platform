"use client";

import { useEffect } from "react";
import { useChat } from "./ChatProvider";

/** Phase 4 M4: the loader script (public/widget.js) keeps its iframe small until this tells it the panel opened — an iframe sized for the full panel at all times would block clicks on the host page around the bubble. */
export function EmbedResizeBridge() {
  const { open } = useChat();

  useEffect(() => {
    window.parent.postMessage({ source: "cx-widget", type: "resize", open }, "*");
  }, [open]);

  return null;
}
